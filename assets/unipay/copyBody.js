// ==UserScript==
// @name         提取QQ钱包支付响应Body
// @namespace    https://iiifox.me/
// @version      1.0.0
// @description  在腾讯充值中心页面中，监听钱包支付接口，提取正常出码的响应 body 并复制到剪贴板
// @author       iiifox
// @match        *://pay.qq.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://iiifox.me/assets/unipay/copyBody.js
// ==/UserScript==

(function () {
    'use strict';

    // 用于监听的目标接口，可扩展
    const TARGET_PATHS = ["/web_save", "/mobile_save"];
    let latestBody = null;
    let bodyBtn = null;

    // 判断 URL 是否是目标接口
    function isTargetUrl(url) {
        return TARGET_PATHS.some(path => url.includes(path));
    }

    // Toast 提示
    function showToast(msg) {
        const toast = document.createElement('div');
        toast.textContent = msg;
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            background: 'rgba(0,0,0,0.85)',
            color: '#fff',
            padding: '8px 14px',
            borderRadius: '6px',
            fontSize: '14px',
            zIndex: 99999,
            opacity: '0',
            transition: 'opacity 0.3s'
        });
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.style.opacity = '1');
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    // 复制文本的通用函数
    async function copyTextUniversal(text) {
        // 优先尝试 Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                showToast('支付响应Body已复制');
                return;
            } catch (err) {
                console.warn('Clipboard API 复制失败，尝试回退:', err);
            }
        }
        // 回退到 execCommand
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.top = '-1000px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(textarea);
            if (ok) {
                showToast('支付响应Body已复制');
                return;
            }
        } catch (err) {
            console.warn('execCommand 复制失败:', err);
        }
        // 最后兜底，手动复制
        prompt('复制失败，请手动复制：', text);
    }

    // 创建浮动按钮
    function createFloatButton() {
        if (bodyBtn) return;

        bodyBtn = document.createElement('button');
        bodyBtn.id = 'df-pay-btn';
        bodyBtn.textContent = '复制支付响应Body';
        Object.assign(bodyBtn.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 99999,
            padding: '10px 16px',
            background: '#2196f3',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            display: 'none'
        });

        bodyBtn.addEventListener('click', () => {
            if (!latestBody) {
                showToast('暂无可复制的支付响应Body');
                return;
            }
            void copyTextUniversal(latestBody);
            bodyBtn.style.display = 'none';
        });

        document.body.appendChild(bodyBtn);
    }

    // 处理响应
    function handleResponse(responseJSON) {
        latestBody = responseJSON;
        createFloatButton();
        bodyBtn.style.display = 'block';
    }

    // 双拦截器：XHR + fetch
    (function () {
        // 统一处理响应的函数
        function handleResponseWrapper(type, responseText) {
            try {
                const resp = JSON.parse(responseText);
                if (resp.ret === 0) {
                    handleResponse(responseText);
                } else {
                    console.log(`【${type}】响应不符合条件，跳过复制`);
                }
            } catch (err) {
                console.error(`【${type}】解析失败：${err.message}`);
            }
        }

        // ----------- XHR 拦截 -----------
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (...args) {
            // 给每个请求绑定 load 事件
            this.addEventListener('load', () => {
                if (this.readyState === 4 && this.status === 200 && isTargetUrl(this.responseURL)) {
                    handleResponseWrapper('XMLHttpRequest', this.responseText);
                }
            });
            // 发起原始请求
            return originalSend.apply(this, args);
        };

        // ----------- fetch 拦截 -----------
        const originalFetch = window.fetch;
        window.fetch = async function (input, init) {
            const url = typeof input === 'string' ? input : input.url;
            const response = await originalFetch(input, init);
            // fetch 响应是流 → clone 一份给 handleResponseWrapper
            if (isTargetUrl(url)) {
                const cloned = response.clone();
                const text = await cloned.text();
                handleResponseWrapper('fetch', text);
            }
            // 返回原始响应给网页
            return response;
        };
    })();

})();
