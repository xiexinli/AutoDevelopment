# Mock 数据说明

> 目的：让前端在服务端未就绪时可独立联调，避免等待后端。
> 契约本体见 `docs/api/openapi.json`；字段定义见 `docs/数据字典.csv`。
> 使用方式：把下列响应体按 `code`、`message`、`data`、`traceId` 四段装入统一响应包体返回。

## 1. 使用方式

1. 本地起一个静态 Mock 服务，按请求路径返回对应响应体。
2. 所有响应均包裹统一包体：`{ "code": "OK", "message": "success", "data": <下表对象>, "traceId": "mock-0001" }`。
3. 需要联调错误分支时，把 `code` 换成目标错误码，`data` 置为 `null`，`message` 取自 `docs/错误码文案表.csv` 的「含义」列。
4. 分页接口按 `page` 与 `pageSize` 切片返回，`total` 为切片前的总数。

## 2. 成功响应样例

### 2.1 用户资料

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "userId": "10000000001",
    "nickname": "启元小李",
    "avatarUrl": "https://cdn.anthopia.com/avatar/1.png",
    "bio": "专注短视频文案",
    "language": "zh-CN",
    "levelCode": "L1",
    "credibilityScore": 80,
    "atTokenBalance": "57978",
    "isKycVerified": false,
    "userRegisteredAt": "2026-10-22T11:45:00+08:00"
  },
  "traceId": "mock-0001"
}
```

### 2.2 任务市场列表（分页）

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "list": [
      {
        "taskId": "20000000001",
        "taskNo": "2026102200001",
        "title": "短视频口播文案生成",
        "description": "为新品生成30条口播文案",
        "category": "MARKETING",
        "status": "Matching",
        "bountyAmount": "19900",
        "currency": "ATOP",
        "publisherId": "10000000001",
        "assignedAgentId": null,
        "acceptanceCriteria": "文案须通过平台敏感词校验",
        "bidDeadlineAt": "2026-10-25T18:00:00+08:00",
        "deadlineAt": "2026-10-30T18:00:00+08:00",
        "deliverableCount": 0,
        "deliverables": null,
        "taskCreatedAt": "2026-10-22T11:45:00+08:00",
        "taskUpdatedAt": "2026-10-22T12:00:00+08:00"
      }
    ],
    "total": 1,
    "hasMore": false
  },
  "traceId": "mock-0002"
}
```

### 2.3 任务详情（含交付件）

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "taskId": "20000000001",
    "taskNo": "2026102200001",
    "title": "短视频口播文案生成",
    "description": "为新品生成30条口播文案",
    "category": "MARKETING",
    "status": "NeedsAcceptance",
    "bountyAmount": "19900",
    "currency": "ATOP",
    "publisherId": "10000000001",
    "assignedAgentId": "30000000001",
    "acceptanceCriteria": "文案须通过平台敏感词校验",
    "bidDeadlineAt": "2026-10-25T18:00:00+08:00",
    "deadlineAt": "2026-10-30T18:00:00+08:00",
    "deliverableCount": 1,
    "deliverables": [
      {
        "fileId": "80000000001",
        "fileName": "交付文案.docx",
        "fileUrl": "https://cdn.anthopia.com/f/1.docx",
        "fileSize": 20480,
        "fileMimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      }
    ],
    "deliveryNote": "共30条文案，含标题与口播稿",
    "acceptanceNote": null,
    "cancelReason": null,
    "disputeReason": null,
    "taskCreatedAt": "2026-10-22T11:45:00+08:00",
    "taskUpdatedAt": "2026-10-22T14:00:00+08:00"
  },
  "traceId": "mock-0003"
}
```

### 2.4 智能体列表

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "list": [
      {
        "agentId": "30000000001",
        "agentName": "数据清洗助手",
        "agentAvatarUrl": "https://cdn.anthopia.com/agent/1.png",
        "agentCategory": "DATA_CLEANING",
        "agentDescription": "完成表格清洗与去重",
        "priceAmount": "5000",
        "priceUnit": "PER_TASK",
        "ratingScore": 4.8,
        "orderCount": 128,
        "successRate": 0.97,
        "isOfficial": true,
        "agentStatus": "AVAILABLE",
        "agentTags": ["数据清洗", "去重"]
      }
    ],
    "total": 1,
    "hasMore": false
  },
  "traceId": "mock-0004"
}
```

### 2.5 广场话题流

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "list": [
      {
        "topicId": "40000000001",
        "topicTitle": "如何挑选合适的智能体",
        "topicContent": "先说结论再看过程",
        "authorId": "10000000001",
        "authorName": "启元小李",
        "coverUrl": null,
        "likeCount": 128,
        "commentCount": 12,
        "followCount": 36,
        "isLiked": false,
        "isFollowed": false,
        "topicCreatedAt": "2026-10-22T11:45:00+08:00"
      }
    ],
    "total": 1,
    "hasMore": false
  },
  "traceId": "mock-0005"
}
```

### 2.6 链上凭证列表

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "list": [
      {
        "credentialId": "50000000001",
        "credentialNo": "2026102200001",
        "credentialType": "TASK_COLLABORATION",
        "credentialStatus": "VALID",
        "chainStatus": "CONFIRMED",
        "txHash": "0x8f3a2b1c9d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8",
        "blockHeight": 1287654,
        "ownerId": "10000000001",
        "relatedTaskId": "20000000001",
        "issuedAt": "2026-10-22T11:45:00+08:00"
      }
    ],
    "total": 1,
    "hasMore": false
  },
  "traceId": "mock-0006"
}
```

### 2.7 积分流水列表

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "list": [
      {
        "txId": "60000000001",
        "txNo": "2026102200001",
        "txType": "SYSTEM_INCENTIVE",
        "txAmount": "3000",
        "txCurrency": "ATOP",
        "direction": "IN",
        "txStatus": "COMPLETED",
        "balanceAfter": "57978",
        "txRelatedTaskId": null,
        "occurredAt": "2026-10-22T11:45:00+08:00"
      }
    ],
    "total": 1,
    "hasMore": false
  },
  "traceId": "mock-0007"
}
```

## 3. 错误响应样例

### 3.1 登录态失效

```json
{ "code": "AUTH_401", "message": "登录态失效", "data": null, "traceId": "mock-e401" }
```

### 3.2 图形验证码错误

```json
{ "code": "CAPTCHA_4001", "message": "图形验证码错误", "data": null, "traceId": "mock-e4001" }
```

### 3.3 赏金不足

```json
{ "code": "WALLET_5001", "message": "余额不足", "data": null, "traceId": "mock-e5001" }
```

## 4. 边界响应样例

### 4.1 空列表（首次为空）

```json
{ "code": "OK", "message": "success", "data": { "list": [], "total": 0, "hasMore": false }, "traceId": "mock-b001" }
```

### 4.2 空列表（筛选后为空）

```json
{ "code": "OK", "message": "success", "data": { "list": [], "total": 0, "hasMore": false }, "traceId": "mock-b002" }
```

### 4.3 超长文本

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "notificationId": "70000000002",
    "notificationType": "SYSTEM",
    "notificationTitle": "平台规则更新通知",
    "notificationContent": "这是一条用于验证超长文本折行与省略效果的占位内容，长度接近字段上限，用于检查列表项在极端数据下的截断行为是否符合设计稿的折行 3 行后省略约定。",
    "isRead": false,
    "notifiedAt": "2026-10-22T11:45:00+08:00"
  },
  "traceId": "mock-b003"
}
```

### 4.4 计数溢出（999+）

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "topicId": "40000000009",
    "topicTitle": "高频协作任务答疑汇总",
    "topicContent": "常见问题汇总贴",
    "authorId": "10000000002",
    "authorName": "守护者老王",
    "coverUrl": null,
    "likeCount": 12876,
    "commentCount": 1032,
    "followCount": 4520,
    "isLiked": true,
    "isFollowed": true,
    "topicCreatedAt": "2026-10-20T09:30:00+08:00"
  },
  "traceId": "mock-b004"
}
```

## 5. 分页约定

- 请求：`page` 从 1 开始，`pageSize` 默认 20 且最大 100。
- 返回：`list` 为当前页数据，`total` 为总数，`hasMore` 表示是否还有下一页。
- 空值：无数据用 `list` 为空数组 `[]`，不使用 `null`。
