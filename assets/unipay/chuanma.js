// ==UserScript==
// @name         自动传码
// @namespace    https://iiifox.me/
// @version      1.1.3
// @description  自动传码到饭票（需填写url与次数）
// @author       iiifox
// @match        *://pay.qq.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://iiifox.me/assets/unipay/chuanma.js
// @downloadURL  https://iiifox.me/assets/unipay/chuanma.js
// @connect      081w5a8cim.top
// @connect      8w0m6rjg3l.top
// ==/UserScript==

(function () {
    'use strict';

    // 用于监听的目标接口，可扩展
    const TARGET_PATHS = ["/web_save", "/mobile_save"];

    // 判断 URL 是否是目标接口
    function isTargetUrl(url) {
        return TARGET_PATHS.some(path => url.includes(path));
    }

    function getConfig() {
        const length = Number(GM_getValue('arrayLength', 3));
        const url = GM_getValue('requestUrl', '');
        // 如果没有输入就返回 null
        if (!length || !url) return null;
        return {length, url};
    }

    // 工具函数：生成 4 位随机数字字符串
    const rand4 = () => Math.floor(Math.random() * 10000).toString().padStart(4, '0');

    function encodeItem(item) {
        const str = JSON.stringify(item);
        const utf8Bytes = new TextEncoder().encode(str);
        let binary = String.fromCharCode(...utf8Bytes);
        return btoa(binary);
    }

    // 处理响应
    function handleResponse(responseJSON) {
        const config = getConfig();
        // 未配置则不发送
        if (!config) return;
        const {length, url} = config;
        if (!url) return;

        let successCount = 0;
        const requests = Array.from({length}).map(() => {
            return new Promise(resolve => {
                const item = structuredClone(responseJSON);
                item.qqwallet_info.qqwallet_tokenId += '&' + rand4();
                const encodedData = encodeItem(item);
                GM_xmlhttpRequest({
                    method: 'POST',
                    url,
                    headers: {"Content-Type": "application/x-www-form-urlencoded"},
                    data: encodedData,
                    onload: xhr => {
                        successCount++;
                        resolve();
                    },
                    onerror: err => {
                        resolve();
                    }
                });
            });
        });

        Promise.all(requests).then(() => {
            alert(`传码完成：成功 ${successCount} 次`);
        });
    }

    // 双拦截器：XHR + fetch
    (function () {
        // 统一处理响应的函数
        function handleResponseWrapper(type, responseText) {
            try {
                const resp = JSON.parse(responseText);
                if (resp.ret === 0) {
                    handleResponse(resp);
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

    // ----------------- 配置窗口 -----------------
    const html = `
<div style="background:white;padding:10px;border:1px solid #ccc;width:300px;">
    <div style="margin-bottom:8px;">
        <button id="showConfigBtn">显示配置窗口</button>
    </div>
    <div id="configPanel" style="display:none;">
        <div style="margin-bottom:5px;">
            <label>账号链接:</label>
            <input type="text" id="requestUrlInput" value="${GM_getValue('requestUrl', '')}" style="width:200px; font-size:12px;">
        </div>
        <div style="margin-bottom:5px;">
            <label>传码次数:</label>
            <input type="number" id="arrayLengthInput" value="${GM_getValue('arrayLength', '')}" style="width:50px;font-size:12px;">
        </div>
        <button id="saveConfigBtn">保存</button>
    </div>
</div>
`;

    // 只在顶层页面创建一次
    if (window.top === window.self) {
        const iframeNode = document.createElement('iframe');
        iframeNode.id = 'iframeNode';
        iframeNode.srcdoc = html;
        iframeNode.style.position = 'fixed';
        iframeNode.style.top = '50px';
        iframeNode.style.left = '10px';
        iframeNode.style.width = '350px';
        iframeNode.style.height = '160px';
        iframeNode.style.border = 'none';
        iframeNode.style.zIndex = 99999;
        document.body.appendChild(iframeNode);

        iframeNode.onload = () => {
            const doc = iframeNode.contentDocument;

            // 显示/隐藏按钮
            doc.getElementById('showConfigBtn').addEventListener('click', () => {
                const panel = doc.getElementById('configPanel');
                if (panel.style.display === 'none') {
                    panel.style.display = 'block';
                    doc.getElementById('showConfigBtn').innerText = '隐藏配置窗口';
                } else {
                    panel.style.display = 'none';
                    doc.getElementById('showConfigBtn').innerText = '显示配置窗口';
                }
            });

            // 保存按钮
            doc.getElementById('saveConfigBtn').addEventListener('click', () => {
                const requestUrl = doc.getElementById('requestUrlInput').value;
                const arrayLength = doc.getElementById('arrayLengthInput').value;
                GM_setValue('requestUrl', requestUrl);
                GM_setValue('arrayLength', arrayLength);
                alert('保存成功');
            });
        };
    }

})();
