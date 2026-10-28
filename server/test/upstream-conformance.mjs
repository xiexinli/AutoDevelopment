import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.AD_LOG_LEVEL = 'fatal';
process.env.AD_DB_PATH = ':memory:';
// 超时按契约默认 60s；测试里加速到 1.5s，验证的是「deadline 覆盖响应体/流」这条路径
process.env.AD_LLM_TIMEOUT_MS = '1500';

// ---------------- 上游桩：OpenAI 兼容 + 飞书开放平台 ----------------

let llmMode = 'ok';           // ok | flaky | bad400 | bad401 | stall | badjson | emptyitems | badsplit
let llmCalls = 0;

const docxCalls = [];
let tenantCalls = 0;
let feishuMode = 'ok';        // ok | forbidden | notfound

function sse(res, chunks) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
  for (const c of chunks) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

const upstream = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  // 区间等参数是编码过的（`sh1!A1%3AZ200`），统一解码后再匹配
  const pathname = decodeURIComponent(url.pathname);
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    // ---------- 大模型 ----------
    if (pathname === '/v1/chat/completions') {
      llmCalls += 1;
      const parsed = body ? JSON.parse(body) : {};
      if (parsed.stream === true) {
        if (llmMode === 'stall') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"cho'); return; }
        sse(res, ['你好', '，这是', '真实流式的', '测试回复。']);
        return;
      }
      if (llmMode === 'flaky' && llmCalls < 3) { json(503, { error: 'busy' }); return; }
      if (llmMode === 'bad400') { json(400, { error: "'response_format.type' must be 'json_schema' or 'text'" }); return; }
      if (llmMode === 'bad401') { json(401, { error: 'invalid api key' }); return; }
      if (llmMode === 'stall') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"choices":'); return; }
      if (llmMode === 'badjson') { json(200, { choices: [{ message: { content: '这不是 JSON' } }] }); return; }
      const sys = parsed.messages?.[0]?.content ?? '';
      if (sys.includes('门禁审核')) {
        if (llmMode === 'emptyitems') { json(200, { choices: [{ message: { content: '{"items":[],"questions":[],"assumptions":[]}' } }] }); return; }
        json(200, { choices: [{ message: { content: '```json\n{"items":[{"item_code":"A1","level":"blocking","verdict":"pass","evidence_ref":"## 背景","suggestion":""}],"questions":[],"assumptions":[]}\n```' } }] });
        return;
      }
      if (sys.includes('需求拆解')) {
        if (llmMode === 'badsplit') { json(200, { choices: [{ message: { content: '{"packs":[{"role":"UI","reqs":["REQ-UI-1"]}]}' } }] }); return; }
        json(200, { choices: [{ message: { content: JSON.stringify({ packs: [
          { role: 'UI', reqs: ['REQ-UI-001'] }, { role: '接口', reqs: ['REQ-API-001'] },
          { role: 'App', reqs: [] }, { role: '埋点', reqs: [] }, { role: '测试', reqs: [] },
        ] }) } }] });
        return;
      }
      json(200, { choices: [{ message: { content: '## 1 覆盖需求\n\n- REQ-UI-001\n\n## 2 元素清单\n\n（真实模型产出）' } }] });
      return;
    }

    // ---------- 飞书 ----------
    const deny = () => json(200, { code: 99991672, msg: 'permission denied: no permission to read this document' });
    if (pathname === '/open-apis/auth/v3/tenant_access_token/internal') {
      tenantCalls += 1;
      json(200, { code: 0, tenant_access_token: 't-tenant', expire: 7200 }); return;
    }
    if (pathname === '/open-apis/authen/v2/oauth/token') {
      json(200, { code: 0, access_token: 't-user' }); return;
    }
    if (pathname === '/open-apis/authen/v1/user_info') {
      json(200, { code: 0, data: { open_id: 'ou_stub', name: '桩用户', avatar_url: '' } }); return;
    }
    if (pathname === '/open-apis/wiki/v2/spaces/get_node') {
      if (feishuMode === 'notfound') { json(200, { code: 131002, msg: 'node not exist' }); return; }
      json(200, { code: 0, data: { node: { obj_type: 'docx', obj_token: 'doc-real', title: '桩文档' } } }); return;
    }
    if (/^\/open-apis\/docx\/v1\/documents\/[^/]+$/.test(pathname)) {
      if (feishuMode === 'forbidden') { deny(); return; }
      json(200, { code: 0, data: { document: { title: '桩文档', revision_id: 7 } } }); return;
    }
    if (/^\/open-apis\/docx\/v1\/documents\/[^/]+\/raw_content$/.test(pathname)) {
      if (feishuMode === 'forbidden') { deny(); return; }
      json(200, { code: 0, data: { content: '第一段正文\n\n第二段正文' } }); return;
    }
    if (/^\/open-apis\/docx\/v1\/documents\/[^/]+\/blocks$/.test(pathname)) {
      if (feishuMode === 'forbidden') { deny(); return; }
      docxCalls.push(url.searchParams.get('page_token'));
      if (!url.searchParams.get('page_token')) {
        json(200, { code: 0, data: {
          has_more: true, page_token: 'p2',
          items: [
            { block_id: 'b1', block_type: 3, heading1: { elements: [{ text_run: { content: '一级标题' } }] } },
            { block_id: 'b2', block_type: 2, text: { elements: [{ text_run: { content: '正文段落' } }] } },
            { block_id: 'b3', block_type: 12, bullet: { elements: [{ text_run: { content: '要点一' } }] } },
            { block_id: 'b4', block_type: 31, table: { property: { row_size: 2, column_size: 2 }, cells: ['c1', 'c2', 'c3', 'c4'] } },
            { block_id: 'c1', block_type: 32, parent_id: 'b4', children: ['t1'] },
            { block_id: 't1', block_type: 2, parent_id: 'c1', text: { elements: [{ text_run: { content: '表头A' } }] } },
            { block_id: 'c2', block_type: 32, parent_id: 'b4', children: ['t2'] },
            { block_id: 't2', block_type: 2, parent_id: 'c2', text: { elements: [{ text_run: { content: '表头B' } }] } },
            { block_id: 'c3', block_type: 32, parent_id: 'b4', children: ['t3'] },
            { block_id: 't3', block_type: 2, parent_id: 'c3', text: { elements: [{ text_run: { content: '值A' } }] } },
            { block_id: 'c4', block_type: 32, parent_id: 'b4', children: ['t4'] },
            { block_id: 't4', block_type: 2, parent_id: 'c4', text: { elements: [{ text_run: { content: '值B' } }] } },
            { block_id: 'b5', block_type: 30, sheet: { token: 'sht-1_sh1' } },
            { block_id: 'b6', block_type: 23, file: { token: 'ft-1', name: '附件一.pdf' } },
            { block_id: 'b7', block_type: 43, board: { token: 'wb-1' } },
            { block_id: 'b8', block_type: 27, image: { token: 'img-1' } },
          ],
        } });
        return;
      }
      json(200, { code: 0, data: { has_more: false, items: [
        { block_id: 'b9', block_type: 4, heading2: { elements: [{ text_run: { content: '第二页标题' } }] } },
      ] } });
      return;
    }
    if (pathname === '/open-apis/sheets/v2/spreadsheets/sht-1/values/sh1!A1:Z200') {
      json(200, { code: 0, data: { valueRange: { values: [['列1', '列2'], ['甲', '乙']] } } }); return;
    }
    if (pathname === '/open-apis/sheets/v3/spreadsheets/sht-standalone') {
      json(200, { code: 0, data: { properties: { title: '桩表格' } } }); return;
    }
    if (pathname === '/open-apis/sheets/v3/spreadsheets/sht-standalone/sheets/query') {
      json(200, { code: 0, data: { sheets: [{ sheet_id: 'sh1', title: '工作表1', grid_properties: { row_count: 2, column_count: 2 } }] } }); return;
    }
    if (pathname === '/open-apis/sheets/v2/spreadsheets/sht-standalone/values/sh1!A1:Z200') {
      json(200, { code: 0, data: { valueRange: { values: [['字段', '说明'], ['a', 'b']] } } }); return;
    }
    json(404, { code: 404, msg: `no stub for ${pathname}` });
  });
});

await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const PORT = upstream.address().port;
const { createRealAdapter } = await import('../src/adapters/llm.ts');
const { createRealAdapter: createFeishu, parseFeishuLink } = await import('../src/adapters/feishu.ts');

/** 每次取一个新适配器实例（适配器本身无状态，这里只是让用例之间互不影响） */
// 两个厂：普通用例给足超时（避免与重试退避耦合），超时/取消用例用 1.5s 加速
const base = `http://127.0.0.1:${PORT}/v1`;
const freshLlm = async () => createRealAdapter(base, 'k', 'stub-model', { timeoutMs: 8000 });
const fastLlm = async () => createRealAdapter(base, 'k', 'stub-model', { timeoutMs: 1500 });

const PRD = '# 桩 PRD\n\n## 背景\n内容\n';
const STD = [{ code: 'A1', level: 'blocking', title: '一句话说明 / 背景' }];

await test('真实上游一致性（OpenAI 兼容 + 飞书开放平台）', async (t) => {
  try {
    await t.test('大模型：JSON 任务解析（含 ```json 围栏）与结构校验', async () => {
      llmMode = 'ok'; llmCalls = 0;
      const llm = await freshLlm();
      const r = await llm.review({ markdown: PRD, level: 'standard', standardItems: STD });
      assert.equal(r.items.length, 1);
      assert.equal(r.items[0].item_code, 'A1');
      assert.equal(r.items[0].group, 'A', 'group 以编号前缀为准');
      assert.match(r.items[0].evidence_ref, /## 背景/, '证据必须指到原文小节');
    });

    await t.test('大模型：空结构审核不得放行', async () => {
      llmMode = 'emptyitems';
      const llm = await freshLlm();
      await assert.rejects(() => llm.review({ markdown: PRD, level: 'standard', standardItems: STD }),
        (e) => e.code === 'UPSTREAM_UNAVAILABLE');
    });

    await t.test('大模型：拆解必须是五角色且编号合法', async () => {
      llmMode = 'badsplit';
      const llm = await freshLlm();
      await assert.rejects(() => llm.split({ markdown: PRD, depth: 'standard' }),
        (e) => e.code === 'UPSTREAM_UNAVAILABLE');
      llmMode = 'ok';
      const llm2 = await freshLlm();
      const s = await llm2.split({ markdown: PRD, depth: 'standard' });
      assert.deepEqual(s.packs.map((p) => p.role), ['UI', '接口', 'App', '埋点', '测试']);
      assert.deepEqual(s.packs[0].reqs, ['REQ-UI-001']);
    });

    await t.test('大模型：Spec 返回 Markdown（不走 JSON 模式）', async () => {
      llmMode = 'ok';
      const llm = await freshLlm();
      const d = await llm.spec({ role: 'UI', requirements: ['REQ-UI-001'], projectName: 'P', context: '- UI：REQ-UI-001', depth: 'standard' });
      assert.match(d.content_md, /^## 1 覆盖需求/m);
    });

    await t.test('大模型：流式对话逐段增量、能拿到整段', async () => {
      llmMode = 'ok';
      const llm = await freshLlm();
      const got = [];
      const text = await llm.chat({ content: '在吗', history: [], onDelta: (d) => got.push(d) });
      assert.ok(got.length >= 2, `应有多次增量，实际 ${got.length}`);
      assert.equal(text, '你好，这是真实流式的测试回复。');
    });

    await t.test('大模型：503 重试两次后成功；400 不重试', async () => {
      llmMode = 'flaky'; llmCalls = 0;
      const llm = await freshLlm();
      const t0 = Date.now();
      try {
        await llm.spec({ role: 'UI', requirements: [], projectName: 'P', context: '', depth: 'standard' });
      } catch (e) {
        assert.fail(`flaky 重试应成功，实际 ${e.code} ${e.message}；调用次数=${llmCalls}，耗时=${Date.now() - t0}ms`);
      }
      assert.equal(llmCalls, 3, `应在第 3 次成功，实际 ${llmCalls}`);
      llmMode = 'bad400'; llmCalls = 0;
      const llm2 = await freshLlm();
      await assert.rejects(() => llm2.review({ markdown: PRD, depth: 'standard', standardItems: STD }),
        (e) => e.code === 'UPSTREAM_UNAVAILABLE' && /HTTP 400/.test(e.message));
      assert.equal(llmCalls, 1, '4xx 不重试');
    });

    await t.test('大模型：鉴权失败给出可读原因', async () => {
      llmMode = 'bad401'; llmCalls = 0;
      const llm = await freshLlm();
      await assert.rejects(() => llm.review({ markdown: PRD, level: 'standard', standardItems: STD }),
        (e) => /鉴权失败/.test(e.message));
    });

    await t.test('大模型：非法 JSON 视为上游失败，不放行', async () => {
      llmMode = 'badjson';
      const llm = await freshLlm();
      await assert.rejects(() => llm.review({ markdown: PRD, level: 'standard', standardItems: STD }),
        (e) => e.code === 'UPSTREAM_UNAVAILABLE');
    });

    await t.test('大模型：响应体挂起触发 60s 级超时（此处 1.5s 加速）', async () => {
      llmMode = 'stall';
      const llm = await fastLlm();
      await assert.rejects(() => llm.spec({ role: 'UI', requirements: [], projectName: 'P', context: '', depth: 'standard' }),
        (e) => e.code === 'UPSTREAM_TIMEOUT');
    });

    await t.test('大模型：调用方取消原样上抛（不得被翻译成 timeout/failed）', async () => {
      llmMode = 'stall';
      const llm = await fastLlm();
      const ac = new AbortController();
      const p = llm.chat({ content: 'x', history: [], signal: ac.signal });
      setTimeout(() => ac.abort(), 100);
      await assert.rejects(() => p, (e) => e.name === 'AbortError');
    });

    await t.test('飞书：链接解析（docx / wiki / sheets / base）', () => {
      assert.deepEqual(parseFeishuLink('https://x.feishu.cn/docx/Abc123def'), { kind: 'docx', token: 'Abc123def' });
      assert.deepEqual(parseFeishuLink('https://x.feishu.cn/wiki/Abc123def'), { kind: 'wiki', token: 'Abc123def' });
      assert.deepEqual(parseFeishuLink('https://x.feishu.cn/sheets/Abc123def'), { kind: 'sheet', token: 'Abc123def' });
      assert.deepEqual(parseFeishuLink('https://x.feishu.cn/base/Abc123def'), { kind: 'base', token: 'Abc123def' });
      assert.equal(parseFeishuLink('https://example.com/whatever'), null);
    });

    await t.test('飞书：Wiki → docx，正文/标题/表格/内嵌表格/附件/白板/图片 逐类正确', async () => {
      feishuMode = 'ok';
      process.env.AD_FEISHU_BASE_URL = `http://127.0.0.1:${PORT}/open-apis`;
      delete process.env.AD_FEISHU_APP_ID; delete process.env.AD_FEISHU_APP_SECRET;
      const f = createFeishu('cli_x', 's', { userToken: 'u-token' });
      assert.equal(f.kind, 'real');
      const r = await f.readDocument('https://x.feishu.cn/wiki/Abc123def');
      assert.equal(r.title, '桩文档');
      assert.equal(r.parts.body.status, 'ok');
      assert.equal(r.parts.body.chars, '第一段正文\n\n第二段正文'.length);
      // 2 个表格：原生表 + 内嵌电子表格
      assert.deepEqual(r.parts.tables.map((x) => x.status), ['ok', 'ok']);
      assert.equal(r.parts.whiteboards.length, 1);
      assert.equal(r.parts.whiteboards[0].status, 'skipped', '白板只登记 token，不假装取到结构化文本');
      assert.deepEqual(r.parts.attachments.map((a) => a.name), ['附件一.pdf']);
      assert.match(r.markdown, /^# 桩文档/m);
      assert.match(r.markdown, /^#{1,2} 一级标题/m, '标题层级');
      assert.match(r.markdown, /- 要点一/, '无序列表');
      assert.match(r.markdown, /\| 表头A \| 表头B \|/, '原生表格渲染');
      assert.match(r.markdown, /\| 值A \| 值B \|/, '表格第二行');
      assert.match(r.markdown, /\| 列1 \| 列2 \|/, '内嵌电子表格渲染');
      assert.match(r.markdown, /附件：附件一\.pdf/);
      assert.match(r.markdown, /白板图/, '白板如实说明');
      assert.match(r.markdown, /!\[图片\]\(img-1\)/, '图片占位');
      assert.match(r.markdown, /第二页标题/, '分页拉全 blocks');
      assert.equal(docxCalls.length, 2, 'blocks 分页拉两次');
    });

    await t.test('飞书：无权限 → FORBIDDEN，文案不泄露存在性', async () => {
      feishuMode = 'forbidden';
      const f = createFeishu('cli_x', 's', { userToken: 'u-token' });
      await assert.rejects(() => f.readDocument('https://x.feishu.cn/docx/Abc123def'),
        (e) => e.code === 'FORBIDDEN' && /没有这篇文档的访问权限/.test(e.message));
    });

    await t.test('飞书：节点不存在 → NOT_FOUND', async () => {
      feishuMode = 'notfound';
      const f = createFeishu('cli_x', 's', { userToken: 'u-token' });
      await assert.rejects(() => f.readDocument('https://x.feishu.cn/wiki/Abc123def'),
        (e) => e.code === 'NOT_FOUND');
    });

    await t.test('飞书：不支持的节点类型明确拒绝，不假装成功', async () => {
      feishuMode = 'ok';
      const f = createFeishu('cli_x', 's', { userToken: 'u-token' });
      await assert.rejects(() => f.readDocument('https://x.feishu.cn/base/Abc123def'),
        (e) => e.code === 'FORMAT_UNSUPPORTED');
      await assert.rejects(() => f.readDocument('这不是链接'), (e) => e.code === 'INVALID_ARGUMENT');
    });

    await t.test('飞书：租户令牌模式（无用户令牌）也能读，且令牌只出现一次获取', async () => {
      feishuMode = 'ok'; tenantCalls = 0;
      const f = createFeishu('cli_x', 's');       // 不给用户令牌 → 走租户令牌
      const a = await f.readDocument('https://x.feishu.cn/docx/Abc123def');
      const b = await f.readDocument('https://x.feishu.cn/docx/Abc123def');
      assert.equal(a.title, '桩文档'); assert.equal(b.title, '桩文档');
      assert.equal(tenantCalls, 1, '租户令牌应缓存复用，只取一次');
    });

    await t.test('飞书：授权码登录 → 用户身份，并把 state 置 confirmed', async () => {
      feishuMode = 'ok';
      const f = createFeishu('cli_x', 's', { redirectUri: 'http://127.0.0.1:9/cb' });
      const q = await f.createQrcode();
      assert.match(q.qrcode_url, /authen\/v1\/authorize/, '返回的是飞书授权页地址');
      assert.match(q.qrcode_url, /client_id=cli_x/);
      assert.equal(await f.scanStatus(q.state), 'pending_scan');
      const id = await f.completeLogin(q.state, 'code-1');
      assert.equal(id.open_id, 'ou_stub');
      assert.equal(await f.scanStatus(q.state), 'confirmed');
      assert.equal(f.takeIdentity(q.state)?.nickname, '桩用户');
    });
  } finally {
    upstream.closeAllConnections?.();
    upstream.close();
    delete process.env.AD_FEISHU_BASE_URL;
  }
});
