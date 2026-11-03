package com.example.myshop

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewOutlineProvider
import android.graphics.Outline

// Deterministic development output. L1 is not Kotlin compilation or L2 evidence.
class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        bindEvents(findViewById(R.id.el_work_001), ::on_el_work_001_click, null, null)
        bindEvents(findViewById(R.id.el_work_002), ::on_el_work_002_click, null, null)
    }
    private fun bindEvents(view: View, click: (() -> Unit)?, longClick: (() -> Unit)?, doubleClick: (() -> Unit)?) {
        var pending: Runnable? = null
        if (click != null || doubleClick != null) view.setOnClickListener {
            if (doubleClick == null) { click?.invoke() }
            else if (pending != null) {
                pending?.let { handler.removeCallbacks(it) }; pending = null; doubleClick.invoke()
            } else {
                val single = Runnable { pending = null; click?.invoke() }
                pending = single; handler.postDelayed(single, 300L)
            }
        }
        if (longClick != null) view.setOnLongClickListener {
            pending?.let { handler.removeCallbacks(it) }; pending = null; longClick.invoke(); true
        }
    }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy() }
    private fun on_el_work_001_click() { /* empty callback: action_type=none */ }
    private fun on_el_work_002_click() { /* empty callback: action_type=none */ }
}
