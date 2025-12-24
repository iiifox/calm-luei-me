// ==UserScript==
// @name         提取长颈鹿代付链接
// @namespace    https://luei.me/
// @version      1.0.0
// @description  打开长颈鹿直冲链接时，捕获代付链接并提供按钮点击复制功能
// @author       luei
// @match        *://38.47.218.60/*
// @grant        none
// @run-at       document-start
// @updateURL    https://luei.me/assets/script/giraffe/copyPayUrl.js
// ==/UserScript==

(function() {
    'use strict';

    const TARGET_API = 'http://38.47.218.60/WebPayCfld.asmx/getCldcwnTest';
    let latestUrl = null; // 保存捕获到的代付链接

    // ================== Toast 提示 ==================
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

    // ================== 复制函数（支持 http） ==================
    async function copyTextSafe(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                showToast('代付链接已复制');
                return;
            }
            throw new Error('navigator.clipboard 不可用');
        } catch (err) {
            console.warn('使用 execCommand 复制:', err);
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
                showToast('代付链接已复制');
            } else {
                prompt('复制失败，请手动复制：', text);
            }
        }
    }

    // ================== 创建浮动按钮 ==================
    function createFloatButton() {
        if (document.getElementById('df-copy-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'df-copy-btn';
        btn.textContent = '复制代付链接';
        Object.assign(btn.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 99999,
            padding: '10px 16px',
            background: '#4caf50',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            display: 'none'
        });

        btn.addEventListener('click', () => {
            if (!latestUrl) {
                showToast('暂无可复制的代付链接');
                return;
            }
            copyTextSafe(latestUrl);
            btn.style.display = 'none'; // 成功后自动隐藏
        });

        document.body.appendChild(btn);
    }

    // ================== 提取代付链接 ==================
    function extractPayUrl(responseText) {
        let dataObj = null;
        // 去掉首尾空格
        responseText = responseText.trim();

        try {
            // 尝试解析一次
            dataObj = JSON.parse(responseText);
        } catch (e1) {
            try {
                // 兜底：如果外层多了一层引号，先去掉再解析
                dataObj = JSON.parse(JSON.parse(responseText));
            } catch (e2) {
                console.warn('JSON 解析失败，回退正则提取');
                dataObj = null;
            }
        }

        if (dataObj && dataObj.data) {
            const data = dataObj.data;
            if (Array.isArray(data) && data.length > 0) {
                return data[0].Device_PayUrl || null;
            } else if (typeof data === 'object') {
                return data.Device_PayUrl || null;
            }
        }

        // JSON 解析失败，回退正则
        const match = responseText.match(/"Device_PayUrl":"(https:\/\/pay\.qq\.com\/[^"]+)"/);
        return match ? match[1] : null;
    }


    // ================== 响应处理 ==================
    function handleResponse(type, responseText, contentType) {
        try {
            const url = extractPayUrl(responseText, contentType);
            if (url) {
                latestUrl = url;
                createFloatButton();
                const btn = document.getElementById('df-copy-btn');
                btn.style.display = 'block';
            } else {
                console.warn('未找到有效的代付链接');
            }
        } catch (err) {
            console.error(`【${type}】解析失败：${err.message}`);
        }
    }

    // ================== XHR 拦截 ==================
    (function() {
        const _open = XMLHttpRequest.prototype.open;
        const _send = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._targetUrl = url;
            return _open.apply(this, [method, url, ...rest]);
        };

        XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('load', () => {
                if (this.readyState === 4 && this.responseURL === TARGET_API) {
                    const contentType = this.getResponseHeader('Content-Type');
                    handleResponse('XMLHttpRequest', this.responseText, contentType);
                }
            });
            return _send.apply(this, args);
        };
    })();

    // ================== fetch 拦截 ==================
    (function() {
        const originalFetch = window.fetch;
        window.fetch = async function(input, init) {
            const url = typeof input === 'string' ? input : input.url;
            if (url === TARGET_API) {
                const response = await originalFetch(input, init);
                const cloned = response.clone();
                const contentType = cloned.headers.get('Content-Type');
                const text = await cloned.text();
                handleResponse('fetch', text, contentType);
                return response;
            }
            return originalFetch(input, init);
        };
    })();

})();
