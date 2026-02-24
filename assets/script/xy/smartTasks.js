// ==UserScript==
// @name         星悦智能任务
// @namespace    http://calm.luei.me/
// @version      1.2.0
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
    const PAGE_SIZE = 20;
    // 智能任务的键名(存放自动任务刷新时间，默认30分钟)
    const XY_SMART_TASKS_KEY = 'smartTasksInterval';
    // 智能任务上次运行时间存储键
    const SMART_TASKS_KEY_LAST_RUN = 'smartTasksLastRunTime';
    // 智能定时任务开关状态
    const TIMER_ENABLED_KEY = 'smartTasksTimerEnabled';

    // 定时任务ID
    let timerId = null;
    let running = false;
    const TASKS_DEFAULT_INTERVAL = 30;
    // 初始化：从油猴存储读取，无则用默认值
    let currentInterval = GM_getValue(XY_SMART_TASKS_KEY, TASKS_DEFAULT_INTERVAL);
    // 计算定时毫秒数（基于存储的值）
    let INTERVAL_TIME = currentInterval * 60 * 1000;


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

    // ========== 分页串行获取所有自动任务ID等相关参数 ==========
    async function getPrefabTaskMap() {
        // 获取所有页的返回结果
        const prefabTasksUrl = "https://sdk.wy7l9.com/api/v1/system/prefab-tasks"
        const first = await fetchPageData(prefabTasksUrl, 1);
        const requests = [];
        for (let i = 2; i <= Math.ceil(first.data.total / PAGE_SIZE); i++) {
            requests.push(fetchPageData(prefabTasksUrl, i));
        }
        const rest = await Promise.all(requests);
        const all = [first, ...rest];
        // 筛选存入map
        const map = new Map();
        for (const res of all) {
            for (const item of res.data.list) {
                let limitNum = item.limitNum == 0
                    ? 0
                    : item.game === "Q币"
                        ? item.limitNum - item.arriveNum
                        : item.limitNum;
                map.set(item.accountId, {
                    id: item.accountId,
                    status: item.status,
                    channelType: item.channelType,
                    limitNum: limitNum,
                    maxAmount: item.maxAmount,
                    minAmount: item.minAmount,
                    productId: item.productId,
                    productName: item.productName,
                    taskType: item.taskType
                });
            }
        }
        return map;
    }

    // ========== 分页获取所有账号列表ID等相关参数 ==========
    async function smartTasks() {
        if (running) return;
        running = true;

        try {
            const prefabMap = await getPrefabTaskMap();

            const accountUrl = "https://sdk.wy7l9.com/api/v1/system/accounts";
            const first = await fetchPageData(accountUrl, 1);
            const reqs = [];
            for (let i = 2; i <= Math.ceil(first.data.total / PAGE_SIZE); i++) {
                reqs.push(fetchPageData(accountUrl, i));
            }
            const rest = await Promise.all(reqs);
            const allItems = [...first.data.list, ...rest.flatMap(r => r.data.list)];

            let successCount = 0;
            await runTaskQueue(allItems, async item => {
                const info = prefabMap.get(item.id);
                if (!info) return;
                const ok = await sendPrefabTasks({
                    activityUrl: item.activityUrl,
                    ...info
                });
                if (ok) successCount++;
            }, Math.min((navigator.hardwareConcurrency || 4) * 2, 30)); // 并发数

            console.log(`✅ ${formatTime(Date.now())} 自动任务完成，共${successCount}个`);
            updateLastRunTime();
        } catch (err) {
            console.error(`❌ ${formatTime(Date.now())} ${err}`);
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
            console.error(`❌ ${formatTime(Date.now())} 执行失败：` + err.message);
            return false;
        }
    }


    // ========== 定时任务控制 ==========
    function startTimer() {
        if (timerId) {
            alert(`❌ 定时任务已开启（当前：${currentInterval}分钟），无需重复开启！`);
            return;
        }
        // ⭐记录开启状态
        GM_setValue(TIMER_ENABLED_KEY, true);
        // 立即执行一次，然后按自定义时间重复执行
        smartTasks();
        timerId = setInterval(smartTasks, INTERVAL_TIME);
        console.log(`✅ ${formatTime(Date.now())} 定时任务已开启（${currentInterval}分钟/次，任务ID：${timerId}）`);
    }

    function stopTimer() {
        if (!timerId) {
            alert('❌ 定时任务未开启，无需停止！');
            return;
        }
        clearInterval(timerId);
        timerId = null;
        // ⭐记录关闭状态
        GM_setValue(TIMER_ENABLED_KEY, false);
        alert(`✅ 定时任务已停止！\n原定时：${currentInterval}分钟`);
    }

    function setCustomInterval() {
        // 弹出输入框，默认显示当前分钟数
        const inputMin = prompt(`请输入QB自动任务分钟数（当前：${currentInterval}分钟）：`, currentInterval);
        // 校验输入（非数字/负数/0则提示）
        if (inputMin === null) return; // 取消输入
        const minNum = Number(inputMin);
        if (isNaN(minNum) || minNum <= 0) {
            alert('❌ 请输入有效的正整数！');
            return;
        }
        // 更新定时参数
        currentInterval = minNum;
        INTERVAL_TIME = minNum * 60 * 1000;
        // 写入油猴存储
        GM_setValue(XY_SMART_TASKS_KEY, minNum);
        // 如果定时任务正在运行，先停止再重启（应用新时间）
        if (timerId) {
            clearInterval(timerId);
            timerId = setInterval(smartTasks, INTERVAL_TIME);
            alert(`✅ 定时时间已修改为：${minNum}分钟！\n当前定时任务已重启`);
        } else {
            alert(`✅ 定时时间已修改为：${minNum}分钟！\n需手动开启定时任务`);
        }
    }


    // ========== 注册油猴菜单 ==========
    GM_registerMenuCommand('🔄 开启定时执行', startTimer);
    GM_registerMenuCommand('⏹️ 停止定时执行', stopTimer);
    GM_registerMenuCommand('📊 查看定时状态', () => {
        const enabled = GM_getValue(TIMER_ENABLED_KEY, false);
        alert(enabled ? "🟢 当前：已开启定时" : "🔴 当前：未开启定时");
    });
    GM_registerMenuCommand('⚙️ 设置定时分钟数', setCustomInterval);
    GM_registerMenuCommand('▶️ 手动执行一次', () => {
        smartTasks();
        alert('✅ 已手动触发执行！');
    });
    GM_registerMenuCommand('📅 查看上次运行时间', () => {
        alert(`📅 脚本上次运行时间：\n${getLastRunTime()}\n当前定时：${currentInterval}分钟`);
    });


    // ========== 脚本执行部分 ==========
    if (GM_getValue(TIMER_ENABLED_KEY, true)) {
        startTimer();
    }
})();
