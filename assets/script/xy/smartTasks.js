// ==UserScript==
// @name         星悦智能任务
// @namespace    http://calm.luei.me/
// @version      1.1.2
// @description  定时执行自动任务，同时遇到出码失败的账号自动转为充值中
// @author       iiifox
// @match        *://sdk.wy7l9.com/*
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      sdk.wy7l9.com
// @updateURL    https://luei.me/assets/script/xy/smartTasks.js
// @downloadURL  https://luei.me/assets/script/xy/smartTasks.js
// ==/UserScript==

(function () {
    'use strict';

    // ========== 配置区 ==========
    // 分页 每页数量
    const PAGE_SIZE = 10;
    // 智能任务的键名(存放自动任务刷新时间，默认30分钟)
    const XY_SMART_TASKS_KEY = 'smartTasksInterval';
    const TASKS_DEFAULT_INTERVAL = 30;
    // 智能任务上次运行时间存储键
    const SMART_TASKS_KEY_LAST_RUN = 'smartTasksLastRunTime';

    // 全局变量
    let timerId = null;        // 定时任务ID
    // 初始化：从油猴存储读取，无则用默认值
    let currentInterval = GM_getValue(XY_SMART_TASKS_KEY, TASKS_DEFAULT_INTERVAL);
    // 计算定时毫秒数（基于存储的值）
    let INTERVAL_TIME = currentInterval * 60 * 1000;
    let running = false;

    // ================== 功能函数 ==================
    function gmFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || "GET",
                url,
                headers: options.headers || {},
                data: options.body,
                timeout: 15000,
                onload: res => {
                    resolve({
                        ok: res.status >= 200 && res.status < 300,
                        status: res.status,
                        data: res.responseText,
                        json: () => JSON.parse(res.responseText)
                    });
                },
                onerror: reject,
                ontimeout: () => reject(new Error("timeout"))
            });
        });
    }

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

    function formatTime(timestamp) {
        if (!timestamp) return '从未运行';
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        const second = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }

    function getLastRunTime() {
        return formatTime(GM_getValue(SMART_TASKS_KEY_LAST_RUN, 0));
    }

    function updateLastRunTime() {
        GM_setValue(SMART_TASKS_KEY_LAST_RUN, Date.now());
    }

    // ========== 分页获取所有自动任务ID等相关参数 ==========
    async function getPrefabTaskMap() {
        let pageNum = 1;
        const map = new Map();
        while (true) {
            const res = await fetchPageData("https://sdk.wy7l9.com/api/v1/system/prefab-tasks", pageNum);
            if (res.code !== 0 || !res.data?.list) return map;
            // 写入Map
            for (const item of res.data?.list) {
                let limitNum = 0
                if (Number(item.limitNum) === 0) {
                    limitNum = 0;
                } else if (item.game === "Q币") {
                    limitNum = Number(item.limitNum) - Number(item.arriveNum);
                } else {
                    limitNum = Number(item.limitNum);
                }
                map.set(Number(item.accountId), {
                    id: Number(item.accountId),
                    status: Number(item.status),
                    channelType: item.channelType,
                    limitNum: limitNum,
                    maxAmount: Number(item.maxAmount),
                    minAmount: Number(item.minAmount),
                    productId: item.productId,
                    productName: item.productName,
                    taskType: item.taskType
                });
            }
            if (pageNum * PAGE_SIZE >= res.data.total) break;
            pageNum++;
        }
        return map;
    }


    // ========== 分页获取所有账号列表ID等相关参数 ==========
    async function smartTasks() {
        if (running) return;
        running = true;

        const prefabMap = await getPrefabTaskMap();
        try {
            const firstPageRes = await fetchPageData("https://sdk.wy7l9.com/api/v1/system/accounts", 1);
            if (firstPageRes.code !== 0 || !firstPageRes.data?.list) {
                return
            }

            const {total, list} = firstPageRes.data;
            const totalPages = Math.ceil(total / PAGE_SIZE);
            const restPages = totalPages > 1 ? await fetchAllPages(totalPages) : [];

            let successCount = 0;
            const allItems = [
                ...list,
                ...restPages.flatMap(r => r.data.list)
            ];
            await runTaskQueue(allItems, async item => {
                const info = prefabMap.get(Number(item.id));
                if (!info) return;
                const ok = await sendPrefabTasks({
                    activityUrl: item.activityUrl,
                    ...info
                });
                if (ok) successCount++;
            }, 5); // 并发数

            showToast(`✅ 自动任务完成，共${successCount}个`);
            updateLastRunTime();
        } catch (err) {
            console.error(err);
            showToast('❌ 自动任务执行失败');
        } finally {
            running = false;
        }
    }

    async function fetchPageData(getUrl, pageNum) {
        const params = new URLSearchParams({
            pageNum: pageNum, pageSize: PAGE_SIZE, enableOrderPull: 1
        });
        const response = await gmFetch(`${getUrl}?${params.toString()}`);
        if (!response.ok) throw new Error(`第${pageNum}页请求失败，状态码：${response.status}`);
        return response.json();
    }

    async function fetchAllPages(totalPages) {
        const tasks = [];
        for (let i = 2; i <= totalPages; i++) {
            tasks.push(fetchPageData("https://sdk.wy7l9.com/api/v1/system/accounts", i));
        }
        return Promise.all(tasks);
    }


    async function runTaskQueue(list, worker, limit = 5) {
        const executing = new Set();
        for (const item of list) {
            const p = Promise.resolve().then(() => worker(item));
            executing.add(p);
            p.finally(() => executing.delete(p));
            if (executing.size >= limit) {
                await Promise.race(executing);
            }
        }
        await Promise.all(executing);
    }

    // ========== 发送自动任务请求 ==========
    async function sendPrefabTasks({
                                       activityUrl,
                                       channelType,
                                       id,
                                       limitNum,
                                       maxAmount,
                                       minAmount,
                                       productId,
                                       productName,
                                       taskType,
                                       status
                                   }) {
        // 状态等于3说明出码失败，需要重开一下拉单
        if (status === 3) {
            const patchRes = await gmFetch(
                'https://sdk.wy7l9.com/api/v1/system/accounts',
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8'
                    },
                    body: JSON.stringify({
                        enableOrderPull: 1,
                        id: id
                    })
                }
            );
            if (!patchRes.ok) throw new Error(`账号ID:${id} 出码失败，状态刷新请求失败，状态码：${patchRes.status}`);
        }
        // 创建任务
        const postData = {
            activityUrl: activityUrl,
            channelType: channelType,
            id: id,
            limitNum: limitNum,
            maxAmount: maxAmount,
            minAmount: minAmount,
            num: "",
            productId: productId,
            productName: productName,
            proxy: "",
            taskType: taskType
        };
        try {
            const taskRes = await gmFetch(
                'https://sdk.wy7l9.com/api/v1/system/prefab-tasks',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                    },
                    body: JSON.stringify(postData)
                }
            );
            if (!taskRes.ok) throw new Error(`账号ID:${id} 自动任务创建失败，状态码：${taskRes.status}`);
            const taskJson = await taskRes.json();

            return taskJson.msg === "ok";
        } catch (err) {
            showToast('❌ 执行失败：' + err.message);
            return false;
        }
    }


    // ========== 定时任务控制（核心：支持自定义时间） ==========
    function startTimer() {
        if (timerId) {
            showToast(`❌ 定时任务已开启（当前：${currentInterval}分钟），无需重复开启！`);
            return;
        }
        // 立即执行一次，然后按自定义时间重复执行
        smartTasks();
        timerId = setInterval(smartTasks, INTERVAL_TIME);
        showToast(`✅ 定时任务已开启（${currentInterval}分钟/次，任务ID：${timerId}）`);
    }

    function stopTimer() {
        if (!timerId) {
            showToast('❌ 定时任务未开启，无需停止！');
            return;
        }
        clearInterval(timerId);
        timerId = null;
        showToast(`✅ 定时任务已停止！\n原定时：${currentInterval}分钟`);
    }

    function showLastRunTime() {
        const lastRunTime = getLastRunTime();
        alert(`📅 脚本上次运行时间：\n${lastRunTime}\n当前定时：${currentInterval}分钟`);
        console.log(`📅 脚本上次运行时间：${lastRunTime}，当前定时：${currentInterval}分钟`);
    }

    function setCustomInterval() {
        // 弹出输入框，默认显示当前分钟数
        const inputMin = prompt(`请输入QB自动任务分钟数（当前：${currentInterval}分钟）：`, currentInterval);

        // 校验输入（非数字/负数/0则提示）
        if (inputMin === null) return; // 取消输入
        const minNum = Number(inputMin);
        if (isNaN(minNum) || minNum <= 0) {
            showToast('❌ 请输入有效的正整数！');
            return;
        }

        // 更新定时参数
        currentInterval = minNum;
        INTERVAL_TIME = minNum * 60 * 1000;
        // 2. 写入油猴存储（核心：持久化）
        GM_setValue(XY_SMART_TASKS_KEY, minNum);

        // 如果定时任务正在运行，先停止再重启（应用新时间）
        if (timerId) {
            clearInterval(timerId);
            timerId = setInterval(smartTasks, INTERVAL_TIME);
            showToast(`✅ 定时时间已修改为：${minNum}分钟！\n当前定时任务已重启`);
        } else {
            showToast(`✅ 定时时间已修改为：${minNum}分钟！\n需手动开启定时任务`);
        }
    }

    function runOnce() {
        smartTasks();
        showToast('✅ 已手动触发执行！');
    }

    // ========== 注册油猴菜单（支持自定义时间） ==========
    GM_registerMenuCommand('🔄 开启定时执行', startTimer);
    GM_registerMenuCommand('⏹️ 停止定时执行', stopTimer);
    GM_registerMenuCommand('⚙️ 设置定时分钟数', setCustomInterval);
    GM_registerMenuCommand('▶️ 手动执行一次', runOnce);
    GM_registerMenuCommand('📅 查看上次运行时间', showLastRunTime);

    // 默认自动开启定时
    startTimer();
})();
