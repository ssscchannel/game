/**
 * 晟自然輔助系統 - 遊戲室 V14-P7
 * 核心邏輯層
 * 包含：PWA 註冊、資料讀取、遊戲引擎、F1/錦標賽邏輯
 */

// ==========================================================
// 0. PWA Service Worker 註冊與全域變數
// ==========================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('[PWA] SW registered:', reg.scope))
            .catch(err => console.error('[PWA] SW failed:', err));
    });
}

const VERSION_HISTORY = {
    "V14-P1": "【PWA 架構重構】資料分離、離線快取支援、跨平台渲染優化。",
    "V14-P2": "【iPhone 16 Pro Max 優化】滿版視窗修正、標題故障藝術風格、Start 按鈕美化、手速動畫。",
    "V14-P6": "【視覺融合與數位風格】修正背景漸層無縫接軌安全區域，並導入 Digital Glitch 標題特效。",
    "V14-P7": "【緊急修正】修復 JS 語法錯誤導致的載入卡住問題，並微調背景漸層深度與過渡位置。"
};

// 這是全域變數，稍後會從 data.json 填入
let APP_DATA = { banks: [] };

const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// ==========================================================
// 1. 音效模組 (AudioContext)
// ==========================================================
const AUDIO = {
    ctx: null,
    init: function() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) this.ctx = new AudioContext();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    },
    playTone: function(freq, type, duration, vol=0.1) {
        if (!this.ctx) this.init();
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },
    playClick: function() { this.playTone(400, 'triangle', 0.05, 0.05); },
    playFlip: function() { this.playTone(600, 'sine', 0.05, 0.03); },
    playMatch: function() { 
        this.playTone(880, 'sine', 0.1, 0.1); 
        setTimeout(()=>this.playTone(1760, 'sine', 0.2, 0.1), 100); 
    },
    playError: function() { 
        this.playTone(150, 'sawtooth', 0.3, 0.1); 
    },
    playAlarm: function() {
        this.playTone(800, 'square', 0.1, 0.05);
    },
    playFanfare: function() {
         if(!this.ctx) this.init();
         [523, 659, 783].forEach((f, i) => { // C E G
             setTimeout(() => this.playTone(f, 'triangle', 0.2, 0.1), i * 100);
         });
    },
    playWin: function() {
        if(!this.ctx) this.init();
        [523, 659, 783, 1046].forEach((f, i) => {
            setTimeout(() => this.playTone(f, 'square', 0.3, 0.1), i * 150);
        });
    }
};

// ==========================================================
// 2. 核心應用邏輯 (APP)
// ==========================================================
const APP = {
    state: {
        currentPlayer: { school:"", name:"" },
        currentBankId: "b1",
        currentMode: "standard",
        history: [],
        leaderboardTabs: { standard: 'b1', survival: 'b1' }
    },
    adminClickCount: 0,
    adminTimer: null,
    pendingAction: null, 

    init: function() {
        // 1. 讀取歷史紀錄
        const saved = localStorage.getItem('cheng_nature_game_log_v2');
        if (saved) APP.state.history = JSON.parse(saved);

        const prefSchool = localStorage.getItem('pref_school');
        if (prefSchool) document.getElementById('input-school').value = prefSchool;
        
        document.getElementById('input-name').value = "";

        // 2. 非同步讀取資料檔 (JSON)
        fetch('./data.json')
            .then(response => {
                if (!response.ok) throw new Error("Network response was not ok");
                return response.json();
            })
            .then(data => {
                APP_DATA = data;
                console.log("[App] Data loaded successfully");
                
                // 資料載入後的初始化動作
                APP.renderBankButtons();
                APP.updateLeaderboardV11(); 
                F1.initSetup();
                TOUR.initSetup();
                
                // 預設選取第一個題庫
                if(APP_DATA.banks.length > 0) APP.state.currentBankId = APP_DATA.banks[0].id;
            })
            .catch(error => {
                console.error("[App] Failed to load data.json:", error);
                alert("無法讀取題庫資料 (data.json)，請檢查檔案是否存在。");
            });

        // 3. 綁定音效啟動事件
        document.body.addEventListener('click', () => AUDIO.init(), {once:true});
        document.body.addEventListener('touchstart', () => AUDIO.init(), {once:true});

        APP.initTouchControl();
        APP.setupHistoryTrap();
    },

    initTouchControl: function() {
        document.addEventListener('touchmove', function(e) {
            let target = e.target;
            let isScrollable = false;
            while (target && target !== document.body) {
                if (target.classList && target.classList.contains('scrollable-y')) {
                    if (target.scrollHeight > target.clientHeight) {
                        isScrollable = true;
                    }
                    break;
                }
                target = target.parentElement;
            }
            if (!isScrollable) {
                e.preventDefault();
            }
        }, { passive: false });

        window.onbeforeunload = function(e) {
            e.preventDefault();
            e.returnValue = '';
            return '';
        };
    },

    setupHistoryTrap: function() {
        history.pushState(null, document.title, location.href);
        window.addEventListener('popstate', function (event) {
            history.pushState(null, document.title, location.href);
        });
    },

    askForPassword: function(action) {
        this.pendingAction = action;
        document.getElementById('pwd-input').value = '';
        document.getElementById('pwd-modal').style.display = 'flex';
        setTimeout(() => document.getElementById('pwd-input').focus(), 100);
    },
    checkPwd: function() {
        const val = document.getElementById('pwd-input').value;
        if (val === '0185') {
            document.getElementById('pwd-modal').style.display = 'none';
            if (this.pendingAction) this.pendingAction();
            this.pendingAction = null;
        } else {
            alert('密碼錯誤');
            document.getElementById('pwd-input').value = '';
        }
    },
    closePwd: function() {
        document.getElementById('pwd-modal').style.display = 'none';
        this.pendingAction = null;
    },

    triggerAdmin: function() {
        APP.adminClickCount++;
        if (APP.adminTimer) clearTimeout(APP.adminTimer);
        APP.adminTimer = setTimeout(() => { APP.adminClickCount = 0; }, 500);
        
        if (APP.adminClickCount >= 3) {
            APP.adminClickCount = 0;
            APP.askForPassword(() => APP.navTo('admin'));
        }
    },

    confirmNavTo: function(screenId) {
        AUDIO.playClick();
        let wasPaused = false;
        if (document.getElementById('screen-game').classList.contains('active')) {
            GAME.pause();
            wasPaused = true;
        }

        if (confirm("確定要返回首頁嗎？目前的進度將會遺失。")) {
            if(wasPaused) GAME.abort(); 
            APP.navTo(screenId);
        } else {
            if (wasPaused) GAME.resume();
        }
    },

    adminSave: function() {
        if (!confirm("確定要備份目前的資料嗎？\n(這將下載一個 .json 檔案)")) return;
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(APP.state.history));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        const date = new Date().toISOString().slice(0,10);
        downloadAnchorNode.setAttribute("download", `game_backup_${date}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    },

    adminImport: function(input) {
        if (!confirm("警告：匯入將會覆蓋或合併目前的資料，確定嗎？")) {
            input.value = ""; return;
        }
        const file = input.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const imported = JSON.parse(e.target.result);
                if (Array.isArray(imported)) {
                    APP.state.history = imported;
                    localStorage.setItem('cheng_nature_game_log_v2', JSON.stringify(APP.state.history));
                    alert("匯入成功！");
                    APP.navTo('lobby');
                } else {
                    alert("檔案格式錯誤");
                }
            } catch (err) {
                alert("讀取失敗：" + err);
            }
        };
        reader.readAsText(file);
    },

    adminClear: function() {
        if (!confirm("危險：確定要「清空所有」歷史紀錄嗎？此動作無法復原！")) return;
        if (!confirm("再次確認：真的要刪除嗎？")) return;
        
        APP.state.history = [];
        localStorage.setItem('cheng_nature_game_log_v2', JSON.stringify([]));
        alert("資料已清空");
        APP.navTo('lobby');
    },

    navTo: function(screenId, filterStr = null) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-' + screenId).classList.add('active');
        document.getElementById('debug-overlay').style.display = 'none';

        if (screenId === 'input') {
            document.getElementById('input-name').value = "";
        }
        if (screenId === 'lobby') APP.updateLeaderboardV11();
        if (screenId === 'history') APP.renderHistory(filterStr);
    },

    savePref: function(key, val) {
        localStorage.setItem('pref_' + key, val);
    },

    selectMode: function(mode) {
        AUDIO.playClick();
        APP.state.currentMode = mode;
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
        
        let btnId = "m-std";
        if (mode === 'standard') btnId = "m-std";
        else if (mode === 'survival') btnId = "m-surv";
        else if (mode === 'f1') btnId = "m-f1";
        else if (mode === 'tournament') btnId = "m-tour";

        document.getElementById(btnId).classList.add('selected');
    },

    renderBankButtons: function() {
        const container = document.getElementById('bank-btn-group');
        container.innerHTML = "";
        if (!APP_DATA.banks) return;
        
        APP_DATA.banks.forEach((b, index) => {
            let btn = document.createElement('button');
            btn.className = 'bank-btn' + (index === 0 ? ' selected' : '');
            btn.innerText = b.title;
            btn.onclick = () => { AUDIO.playClick(); APP.selectBank(b.id, btn); };
            container.appendChild(btn);
        });
    },

    selectBank: function(bankId, btnElement) {
        APP.state.currentBankId = bankId;
        document.querySelectorAll('.bank-btn').forEach(b => b.classList.remove('selected'));
        btnElement.classList.add('selected');
    },

    switchLeaderboardTab: function(mode, bankId) {
        AUDIO.playClick();
        APP.state.leaderboardTabs[mode] = bankId;
        APP.updateLeaderboardV11();
    },

    updateLeaderboardV11: function() {
        const container = document.getElementById('leaderboard-grid');
        container.innerHTML = "";
        
        if(!APP_DATA.banks) return;

        const blocks = [
            { id: 'standard', name: '標準競速', type: 'active' },
            { id: 'survival', name: '生存模式', type: 'active' },
            { id: 'f1', name: 'F1 積分賽', type: 'active-f1' }, 
            { id: 'tournament', name: '錦標賽', type: 'active-tour' } 
        ];

        blocks.forEach(block => {
            const box = document.createElement('div');
            box.className = 'mode-box';
            
            box.onclick = () => {
                AUDIO.playClick();
                let filterStr = "";
                if (block.id === 'f1' || block.id === 'tournament') {
                    filterStr = block.id;
                } else {
                    const currentBank = APP.state.leaderboardTabs[block.id] || 'b1';
                    filterStr = `${block.id}:${currentBank}`;
                }
                APP.navTo('history', filterStr);
            };

            const header = document.createElement('div');
            header.className = 'mode-header';
            header.innerText = block.name;
            box.appendChild(header);

            if (block.type === 'active') {
                const currentTab = APP.state.leaderboardTabs[block.id] || 'b1';
                const tabContainer = document.createElement('div');
                tabContainer.className = 'mini-tabs';
                
                APP_DATA.banks.forEach(b => {
                    const tab = document.createElement('div');
                    tab.className = 'mini-tab' + (b.id === currentTab ? ' active' : '');
                    let shortName = b.title.replace('常見','').replace('實驗','');
                    if (shortName.length > 3) shortName = shortName.substring(0,3);
                    tab.innerText = shortName;
                    tab.onclick = (e) => {
                        e.stopPropagation();
                        APP.switchLeaderboardTab(block.id, b.id);
                    };
                    tabContainer.appendChild(tab);
                });
                box.appendChild(tabContainer);

                const listContainer = document.createElement('div');
                listContainer.className = 'tower-list';
                const logs = APP.state.history.filter(h => h.mode === block.id && h.bankId === currentTab);
                
                if (block.id === 'survival') {
                    logs.sort((a,b) => (b.time - a.time) || (a.timestamp - b.timestamp));
                } else {
                    logs.sort((a,b) => (a.time - b.time) || (a.timestamp - b.timestamp));
                }
                
                APP.renderRankList(listContainer, logs.slice(0, 5));
                box.appendChild(listContainer);

            } else if (block.type === 'active-f1') {
                const listContainer = document.createElement('div');
                listContainer.className = 'tower-list';
                listContainer.style.marginTop = '10px';
                const logs = APP.state.history.filter(h => h.mode === 'f1');
                logs.sort((a,b) => (b.score - a.score) || (a.time - b.time) || (a.timestamp - b.timestamp));
                APP.renderRankList(listContainer, logs.slice(0, 5), 'f1');
                box.appendChild(listContainer);
            
            } else if (block.type === 'active-tour') {
                const listContainer = document.createElement('div');
                listContainer.className = 'tower-list';
                listContainer.style.marginTop = '10px';
                const logs = APP.state.history.filter(h => h.mode === 'tournament' && h.score === 1); 
                logs.sort((a,b) => (b.rounds - a.rounds) || (a.avgTime - b.avgTime) || (a.timestamp - b.timestamp));
                APP.renderRankList(listContainer, logs.slice(0, 5), 'tour');
                box.appendChild(listContainer);
            }
            container.appendChild(box);
        });
    },

    renderRankList: function(container, list, type = 'std') {
        if (list.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:20px; color:#666; font-size:0.7rem;">尚無紀錄</div>`;
        } else {
            list.forEach((log, index) => {
                let rankDisplay = index + 1;
                let colorClass = "";
                if (index === 0) { rankDisplay = "🥇"; colorClass="color:#ffd700;"; }
                else if (index === 1) { rankDisplay = "🥈"; colorClass="color:#e0e0e0;"; }
                else if (index === 2) { rankDisplay = "🥉"; colorClass="color:#cd7f32;"; }

                const row = document.createElement('div');
                
                if (type === 'f1') {
                    row.className = 'rank-row f1-row';
                    row.innerHTML = `
                        <span class="rank-idx" style="${colorClass}">${rankDisplay}</span>
                        <span class="rank-name">${log.player}</span>
                        <span class="rank-pts">${log.score}pts</span>
                        <span class="rank-time">${log.time.toFixed(2)}s</span>
                    `;
                } else if (type === 'tour') {
                    row.className = 'rank-row tour-row';
                    row.innerHTML = `
                        <span class="rank-idx" style="${colorClass}">${rankDisplay}</span>
                        <span class="rank-name">${log.player}</span>
                        <span class="rank-rounds">${log.rounds}輪</span>
                        <span class="rank-avg">${log.avgTime.toFixed(2)}s</span>
                    `;
                } else {
                    row.className = 'rank-row';
                    let rightContent = `<span class="rank-time">${log.time.toFixed(2)}s</span>`;
                    if (log.mode === 'survival') rightContent = `<span class="rank-time" style="color:#e74c3c">${log.time.toFixed(2)}s</span>`;
                    row.innerHTML = `
                        <div style="display:flex; align-items:center; overflow:hidden;">
                            <span class="rank-idx" style="${colorClass}">${rankDisplay}</span>
                            <span class="rank-name">${log.player}</span>
                        </div>
                        <div style="flex-shrink:0;">${rightContent}</div>
                    `;
                }
                container.appendChild(row);
            });
        }
    },

    renderHistory: function(filterStr) {
        const list = document.getElementById('history-list');
        const title = document.getElementById('hist-title');
        list.innerHTML = "";
        let logs = [...APP.state.history];
        
        let targetMode = null;
        let targetBank = null;

        if (filterStr === 'f1') {
            targetMode = 'f1';
            title.innerText = "F1 積分賽";
        } else if (filterStr === 'tournament') {
            targetMode = 'tournament';
            title.innerText = "錦標賽";
        } else if (filterStr && filterStr.includes(':')) {
            const parts = filterStr.split(':');
            targetMode = parts[0];
            targetBank = parts[1];
            const bank = APP_DATA.banks.find(b => b.id === targetBank);
            const bankTitle = bank ? bank.title : targetBank;
            const modeTitle = targetMode === 'standard' ? '標準競速' : '生存模式';
            title.innerText = `${modeTitle} - ${bankTitle}`;
        } else {
            title.innerText = "所有歷史紀錄";
        }
        
        if (targetMode) {
            logs = logs.filter(l => l.mode === targetMode);
            if (targetBank) logs = logs.filter(l => l.bankId === targetBank);

            if (targetMode === 'f1') {
                logs.sort((a,b) => (b.score - a.score) || (a.time - b.time) || (a.timestamp - b.timestamp));
            } else if (targetMode === 'survival') {
                logs.sort((a,b) => (b.time - a.time) || (a.timestamp - b.timestamp));
            } else if (targetMode === 'tournament') {
                logs.sort((a,b) => (a.score - b.score) || (b.rounds - a.rounds) || (a.avgTime - b.avgTime));
            } else {
                logs.sort((a,b) => (a.time - b.time) || (a.timestamp - b.timestamp));
            }
        } else {
            logs.sort((a,b) => b.timestamp - a.timestamp);
        }

        if (logs.length > 100) logs = logs.slice(0, 100);

        if (logs.length === 0) {
            list.innerHTML = "<div style='text-align:center; color:#999; padding:20px;'>暫無資料</div>";
            return;
        }

        logs.forEach(log => {
            let div = document.createElement('div');
            div.className = "hist-row";
            
            let ts = log.timestamp;
            if (!ts && log.date) {
                ts = Date.parse(log.date);
            }
            if (!ts || isNaN(ts)) {
                ts = Date.now(); 
            }
            
            let d = new Date(ts);
            let dateStr = `${d.getFullYear().toString().substr(-2)}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')}`;

            let scoreDisplay = "";
            if (log.mode === 'f1') {
                scoreDisplay = `${log.score}pts / ${log.time.toFixed(2)}s`;
            } else if (log.mode === 'survival') {
                scoreDisplay = `<span style="color:#e74c3c">${log.time.toFixed(2)}s</span>`;
            } else if (log.mode === 'tournament') {
                let rankStr = log.score === 1 ? "🥇" : (log.score === 2 ? "🥈" : (log.score===3 ? "🥉" : ""));
                if(!rankStr) rankStr = "淘汰";
                scoreDisplay = `${rankStr}(${log.rounds}輪) / ${log.avgTime.toFixed(2)}s`;
            } else {
                scoreDisplay = `${log.time.toFixed(2)}s`;
            }
            
            div.innerHTML = `
                <span class="hist-name">${log.player}</span>
                <span class="hist-date">${dateStr}</span>
                <span class="hist-score" style="color:${log.mode==='survival'?'#e74c3c':'var(--primary-neon)'}">
                    ${scoreDisplay}
                </span>
            `;
            list.appendChild(div);
        });
    },

    saveRecord: function(result) {
        const name = result.player || document.getElementById('input-name').value;
        const school = result.school || document.getElementById('input-school').value;
        
        const record = {
            player: name, school: school, 
            bankId: result.bankId || APP.state.currentBankId, 
            bankTitle: result.bankTitle || "",
            mode: result.mode || APP.state.currentMode, 
            time: result.time, 
            avgTime: result.avgTime || 0,
            rounds: result.rounds || 0,
            score: result.score, 
            errors: result.errors, 
            date: new Date().toLocaleDateString(),
            timestamp: new Date().getTime() 
        };
        
        APP.state.history.push(record);
        localStorage.setItem('cheng_nature_game_log_v2', JSON.stringify(APP.state.history));
    }
};

// ==========================================================
// 3. F1 積分賽模組
// ==========================================================
const F1 = {
    config: { numPlayers: 4, rounds: [] }, 
    players: [], 
    state: { currentRoundIdx: 0, turnQueue: [], turnPtr: 0 },
    debugClicks: 0, debugTimer: null,

    initSetup: function() {
        if(!APP_DATA.banks) return;
        const selects = ['sel-r1', 'sel-r2', 'sel-r3'];
        selects.forEach((sid, idx) => {
            const el = document.getElementById(sid);
            if(el) {
                el.innerHTML = "";
                APP_DATA.banks.forEach(b => {
                    let opt = document.createElement('option');
                    opt.value = b.id; opt.innerText = b.title;
                    if(idx === 0 && b.id==='b1') opt.selected = true;
                    if(idx === 1 && b.id==='b2') opt.selected = true;
                    if(idx === 2 && b.id==='b3') opt.selected = true;
                    el.appendChild(opt);
                });
            }
        });
        const disp = document.getElementById('disp-f1-players');
        if(disp) disp.innerText = F1.config.numPlayers;
    },
    
    triggerDebug: function() {
        F1.debugClicks++;
        if (F1.debugTimer) clearTimeout(F1.debugTimer);
        F1.debugTimer = setTimeout(() => { F1.debugClicks = 0; }, 500);
        if (F1.debugClicks >= 3) { 
            F1.debugClicks = 0; 
            APP.askForPassword(() => F1.showDebugMenu());
        }
    },
    
    showDebugMenu: function() {
        const overlay = document.getElementById('debug-overlay');
        overlay.innerHTML = `
            <div style="background:#222; padding:20px; border-radius:15px; width:80%; text-align:center; border:2px solid #555;">
                <h3 style="color:#f1c40f; margin-top:0;">🔧 F1 模擬除錯</h3>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button class="debug-btn" onclick="F1.simRound(0)">模擬 R1 排位賽</button>
                    <button class="debug-btn" onclick="F1.simRound(1)">模擬 R2 衝刺賽</button>
                    <button class="debug-btn" onclick="F1.simRound(2)">模擬 R3 決賽</button>
                    <button class="debug-btn" onclick="F1.showDebugPodium()">模擬 最終頒獎</button>
                    <button class="debug-btn" style="background:#c0392b" onclick="document.getElementById('debug-overlay').style.display='none'">關閉</button>
                </div>
            </div>
        `;
        overlay.style.display = 'flex';
    },

    simRound: function(rIdx) {
        document.getElementById('debug-overlay').style.display = 'none';
        F1.config.numPlayers = 4;
        F1.players = [];
        for(let i=0; i<4; i++) {
            F1.players.push({ 
                id: i, name: `模擬選手${i+1}`, 
                roundTimes: [10+Math.random()*5, 10+Math.random()*5, 10+Math.random()*5], 
                roundPoints: [0,0,0], totalPoints: 0, lastErrors: 0 
            });
        }
        if(rIdx > 0) F1.players.forEach(p => { p.roundPoints[0] = Math.floor(Math.random()*25); p.totalPoints += p.roundPoints[0]; });
        if(rIdx > 1) F1.players.forEach(p => { p.roundPoints[1] = Math.floor(Math.random()*25); p.totalPoints += p.roundPoints[1]; });
        
        F1.state.currentRoundIdx = rIdx;
        F1.calcRoundResult(false);
    },
    
    showDebugPodium: function() {
        document.getElementById('debug-overlay').style.display = 'none';
        let mockPlayers = [
            { name: "冠軍模擬", totalPoints: 60 },
            { name: "亞軍模擬", totalPoints: 45 },
            { name: "季軍模擬", totalPoints: 30 },
            { name: "路人甲", totalPoints: 10 },
            { name: "路人乙", totalPoints: 5 }
        ];
        F1.renderPodium(mockPlayers);
        APP.navTo('f1-podium');
    },

    adjustPlayers: function(delta) {
        AUDIO.playClick();
        let newVal = F1.config.numPlayers + delta;
        if (newVal < 2) newVal = 2; if (newVal > 30) newVal = 30;
        F1.config.numPlayers = newVal;
        document.getElementById('disp-f1-players').innerText = newVal;
    },

    createRace: function() {
        AUDIO.playClick();
        const num = F1.config.numPlayers;
        F1.config.rounds = [
            document.getElementById('sel-r1').value,
            document.getElementById('sel-r2').value,
            document.getElementById('sel-r3').value
        ];
        F1.players = [];
        for(let i=0; i<num; i++) {
            F1.players.push({ id: i, name: "", roundTimes: [0, 0, 0], roundPoints: [0, 0, 0], totalPoints: 0, lastErrors: 0 });
        }
        F1.startRound(0);
    },

    startRound: function(rIdx) {
        F1.state.currentRoundIdx = rIdx;
        let queue = F1.players.map(p => p.id);
        if (rIdx > 0) queue.sort(() => Math.random() - 0.5); 
        F1.state.turnQueue = queue;
        F1.state.turnPtr = 0;
        F1.showReadyScreen();
    },

    showReadyScreen: function() {
        APP.navTo('f1-ready');
        const rIdx = F1.state.currentRoundIdx;
        const pIdx = F1.state.turnQueue[F1.state.turnPtr];
        const player = F1.players[pIdx];

        document.getElementById('ready-round-title').innerText = `Round ${rIdx+1} / 3`;

        if (rIdx === 0) {
            document.getElementById('r1-name-input-area').style.display = 'block';
            document.getElementById('rx-name-display').style.display = 'none';
            document.getElementById('r1-seat-num').innerText = `${pIdx + 1} 號`;
            document.getElementById('inp-current-name').value = "";
            document.getElementById('inp-current-name').focus();
        } else {
            document.getElementById('r1-name-input-area').style.display = 'none';
            document.getElementById('rx-name-display').style.display = 'block';
            document.getElementById('rx-name-display').innerText = player.name || `選手 ${pIdx+1}`;
        }
    },

    goPlay: function() {
        AUDIO.playClick();
        const rIdx = F1.state.currentRoundIdx;
        const pIdx = F1.state.turnQueue[F1.state.turnPtr];
        
        if (rIdx === 0) {
            const nameVal = document.getElementById('inp-current-name').value.trim();
            if (!nameVal) { alert("請輸入選手名稱！"); return; }
            if (nameVal.length > 6) { alert("名稱最多 6 個字！"); return; } 
            
            const isDup = F1.players.some(p => p.id !== pIdx && p.name === nameVal);
            if (isDup) { alert("名稱已存在，請勿重複！"); return; }
            
            F1.players[pIdx].name = nameVal;
        }

        const player = F1.players[pIdx];
        APP.state.currentPlayer.name = player.name;
        APP.state.currentBankId = F1.config.rounds[rIdx];
        
        const bankTitle = APP_DATA.banks.find(b=>b.id===APP.state.currentBankId).title;
        document.getElementById('player-disp').innerText = `🏎️ ${player.name}`;
        document.getElementById('life-bar-wrap').style.display = 'none';
        document.getElementById('timer').style.color = 'var(--primary-neon)';

        GAME.initGrid(false); 
        APP.navTo('game');
    },

    handleGameEnd: function(time, errors) {
        const pIdx = F1.state.turnQueue[F1.state.turnPtr];
        F1.players[pIdx].roundTimes[F1.state.currentRoundIdx] = time;
        F1.players[pIdx].lastErrors = errors;
        
        F1.state.turnPtr++;
        if (F1.state.turnPtr >= F1.players.length) {
            if (F1.state.currentRoundIdx === 2) {
                F1.calcRoundResult(true); 
                F1.showPodium();
            } else {
                F1.calcRoundResult();
            }
        } else {
            F1.showReadyScreen();
        }
    },

    calcRoundResult: function(silent = false) {
        if(!silent) AUDIO.playFanfare();

        const rIdx = F1.state.currentRoundIdx;
        let roundRankList = [...F1.players];
        roundRankList.sort((a,b) => a.roundTimes[rIdx] - b.roundTimes[rIdx]);
        
        roundRankList.forEach((p, rank) => {
            let points = 0;
            if (rank < F1_POINTS.length) points = F1_POINTS[rank];
            if (p.lastErrors === 0) points += 2;
            p.roundPoints[rIdx] = points;
            p.totalPoints += points;
        });

        if (silent) return;

        let displayList = [...F1.players];
        if (rIdx > 0) {
            displayList.sort((a,b) => (b.totalPoints - a.totalPoints) || (a.roundTimes.reduce((x,y)=>x+y,0) - b.roundTimes.reduce((x,y)=>x+y,0)));
        } else {
            displayList.sort((a,b) => a.roundTimes[0] - b.roundTimes[0]);
        }

        const tbody = document.getElementById('rr-tbody');
        tbody.innerHTML = "";
        displayList.forEach((p, rank) => {
            const tr = document.createElement('tr');
            let displayTime = (rIdx > 0) ? p.roundTimes.slice(0, rIdx+1).reduce((acc, v) => acc + v, 0).toFixed(2) : p.roundTimes[rIdx].toFixed(2);
            tr.innerHTML = `<td>${rank+1}</td><td>${p.name}</td><td class="hl-score">${displayTime}s</td><td class="hl-points">${p.totalPoints} <small>pts</small></td>`;
            tbody.appendChild(tr);
        });

        document.getElementById('rr-title').innerText = `Round ${rIdx+1} 結算`;
        document.getElementById('btn-next-round').innerText = "進入下一輪";
        APP.navTo('f1-round-result');
    },

    nextRound: function() {
        if (F1.state.currentRoundIdx < 2) F1.startRound(F1.state.currentRoundIdx + 1);
    },

    showPodium: function() {
        AUDIO.playWin();
        let finalRank = [...F1.players];
        finalRank.sort((a,b) => {
            if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
            return a.roundTimes.reduce((x,y)=>x+y,0) - b.roundTimes.reduce((x,y)=>x+y,0);
        });

        const school = document.getElementById('input-school').value;
        finalRank.forEach(p => {
            APP.saveRecord({
                player: p.name, school: school, bankId: 'f1-mix',
                mode: 'f1', time: p.roundTimes.reduce((x,y)=>x+y,0), score: p.totalPoints, errors: 0
            });
        });

        F1.renderPodium(finalRank);
        APP.navTo('f1-podium');
    },

    renderPodium: function(rankList) {
        const podium = document.getElementById('podium-area');
        podium.innerHTML = "";
        
        const order = [1, 0, 2];
        order.forEach(rankIdx => {
            if (rankIdx < rankList.length) {
                const p = rankList[rankIdx];
                let crownHtml = (rankIdx === 0) ? `<div class="crown-icon">👑</div>` : "";
                const bar = document.createElement('div');
                bar.className = `podium-bar p-${rankIdx+1}`;
                bar.innerHTML = `${crownHtml}<div class="p-name">${p.name}</div><div class="p-rank">${rankIdx+1}</div><div class="pts-disp">${p.totalPoints} pts</div>`;
                podium.appendChild(bar);
            }
        });

        const listContainer = document.getElementById('podium-list');
        listContainer.innerHTML = "";
        if (rankList.length > 3) {
            for(let i=3; i<rankList.length; i++) {
                const p = rankList[i];
                const row = document.createElement('div');
                row.className = "p-row";
                row.innerHTML = `<span class="p-idx">${i+1}</span><span class="p-n">${p.name}</span><span class="p-s">${p.totalPoints} pts</span>`;
                listContainer.appendChild(row);
            }
        } else {
            listContainer.innerHTML = "<div style='text-align:center; color:#666; font-size:0.8rem;'></div>";
        }
    }
};

// ==========================================================
// 4. Tour (錦標賽) 模組
// ==========================================================
const TOUR = {
    config: { numPlayers: 8, bankId: 'b1' },
    players: [], 
    matchQueue: [], 
    currentMatchIdx: 0,
    stage: '', 
    
    vsData: { p1: null, p2: null, p1Time: null, p2Time: null },
    
    debugClicks: 0, debugTimer: null,

    initSetup: function() {
        if(!APP_DATA.banks) return;
        const el = document.getElementById('sel-tour-bank');
        if(el) {
            el.innerHTML = "";
            APP_DATA.banks.forEach(b => {
                let opt = document.createElement('option');
                opt.value = b.id; opt.innerText = b.title;
                el.appendChild(opt);
            });
        }
        const disp = document.getElementById('disp-tour-players');
        if(disp) disp.innerText = TOUR.config.numPlayers;
    },
    
    triggerDebug: function() {
        TOUR.debugClicks++;
        if (TOUR.debugTimer) clearTimeout(TOUR.debugTimer);
        TOUR.debugTimer = setTimeout(() => { TOUR.debugClicks = 0; }, 500);
        if (TOUR.debugClicks >= 3) { 
            TOUR.debugClicks = 0; 
            APP.askForPassword(() => TOUR.showDebugMenu());
        }
    },
    
    showDebugMenu: function() {
        const overlay = document.getElementById('debug-overlay');
        overlay.innerHTML = `
            <div style="background:#222; padding:20px; border-radius:15px; width:80%; text-align:center; border:2px solid #555;">
                <h3 style="color:#f1c40f; margin-top:0;">🔧 錦標賽 模擬除錯</h3>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button class="debug-btn" onclick="TOUR.simStage('regular')">模擬 初賽對戰</button>
                    <button class="debug-btn" onclick="TOUR.simStage('semi')">模擬 準決賽</button>
                    <button class="debug-btn" onclick="TOUR.simStage('final')">模擬 冠軍戰</button>
                    <button class="debug-btn" onclick="TOUR.showPodium()">模擬 榮耀榜</button>
                    <button class="debug-btn" style="background:#c0392b" onclick="document.getElementById('debug-overlay').style.display='none'">關閉</button>
                </div>
            </div>
        `;
        overlay.style.display = 'flex';
    },
    
    simStage: function(stg) {
        document.getElementById('debug-overlay').style.display = 'none';
        TOUR.stage = stg;
        TOUR.matchQueue = [
            { p1: {name:"模擬A", totalTime:0, matchesCount:0}, p2: {name:"模擬B", totalTime:0, matchesCount:0} }
        ];
        TOUR.currentMatchIdx = 0;
        TOUR.showNextMatchVS();
    },

    adjustPlayers: function(delta) {
        AUDIO.playClick();
        let newVal = TOUR.config.numPlayers + delta;
        if (newVal < 4) newVal = 4; if (newVal > 32) newVal = 32;
        TOUR.config.numPlayers = newVal;
        document.getElementById('disp-tour-players').innerText = newVal;
    },

    goToRegistration: function() {
        AUDIO.playClick();
        TOUR.config.bankId = document.getElementById('sel-tour-bank').value;
        const container = document.getElementById('reg-list');
        container.innerHTML = "";
        
        for(let i=0; i<TOUR.config.numPlayers; i++) {
            let inp = document.createElement('input');
            inp.type = "text";
            inp.className = "reg-input";
            inp.placeholder = `選手 ${i+1}`;
            inp.id = `reg-p-${i}`;
            inp.maxLength = 6; 
            container.appendChild(inp);
        }
        APP.navTo('tour-reg');
    },

    generateBracket: function() {
        AUDIO.playClick();
        TOUR.players = [];
        const names = new Set();
        for(let i=0; i<TOUR.config.numPlayers; i++) {
            let val = document.getElementById(`reg-p-${i}`).value.trim();
            if(!val) val = `選手${i+1}`;
            
            if(names.has(val)) {
                alert(`錯誤：名稱「${val}」重複了！請區分。`);
                return;
            }
            names.add(val);
            
            TOUR.players.push({
                id: i, name: val, active: true, 
                totalTime: 0, matchesCount: 0, 
                finalRank: 0 
            });
        }
        
        TOUR.stage = 'regular';
        TOUR.setupRoundMatches();
    },

    setupRoundMatches: function() {
        let activeList = TOUR.players.filter(p => p.active);
        
        if (activeList.length === 4 && TOUR.stage === 'regular') {
            TOUR.stage = 'semi'; 
        }

        activeList.sort(() => Math.random() - 0.5);

        TOUR.matchQueue = [];
        
        let limit = activeList.length - (activeList.length % 2);
        for(let i=0; i<limit; i+=2) {
            TOUR.matchQueue.push({ p1: activeList[i], p2: activeList[i+1] });
        }

        TOUR.currentMatchIdx = 0;
        TOUR.showNextMatchVS();
    },

    showNextMatchVS: function() {
        if (TOUR.currentMatchIdx >= TOUR.matchQueue.length) {
            TOUR.checkNextStage();
            return;
        }

        const match = TOUR.matchQueue[TOUR.currentMatchIdx];
        APP.navTo('tour-vs');
        
        let stageName = "錦標賽";
        if (TOUR.stage === 'semi') stageName = "準決賽";
        else if (TOUR.stage === 'bronze') stageName = "季軍戰";
        else if (TOUR.stage === 'final') stageName = "冠軍戰";
        else stageName = `第一輪`;

        document.getElementById('vs-stage-name').innerText = stageName;
        document.getElementById('vs-p1-name').innerText = match.p1.name;
        document.getElementById('vs-p2-name').innerText = match.p2.name;
        
        document.getElementById('vs-card-p1').className = "vs-card vs-card-p1";
        document.getElementById('vs-card-p2').className = "vs-card vs-card-p2";

        TOUR.vsData = { p1: match.p1, p2: match.p2, p1Time: null, p2Time: null };
        document.getElementById('btn-tour-action').innerText = `先攻：${match.p1.name}`;
        document.getElementById('btn-tour-action').style.display = 'block'; 
        document.getElementById('vs-instruction').style.display = 'none';
    },

    startMatch: function() {
        AUDIO.playClick();
        let currentPlayer = null;
        if (TOUR.vsData.p1Time === null) {
            currentPlayer = TOUR.vsData.p1;
        } else {
            currentPlayer = TOUR.vsData.p2;
        }

        APP.state.currentPlayer.name = currentPlayer.name;
        APP.state.currentBankId = TOUR.config.bankId;
        
        const bankTitle = APP_DATA.banks.find(b=>b.id===TOUR.config.bankId).title;
        document.getElementById('player-disp').innerText = `🏆 ${currentPlayer.name}`;
        document.getElementById('life-bar-wrap').style.display = 'none';
        document.getElementById('timer').style.color = 'var(--primary-neon)';

        GAME.initGrid(false);
        APP.navTo('game');
    },

    handleGameEnd: function(time, errors) {
        if (TOUR.vsData.p1Time === null) {
            TOUR.vsData.p1Time = time;
            APP.navTo('tour-vs');
            document.getElementById('btn-tour-action').innerText = `後攻：${TOUR.vsData.p2.name}`;
            document.getElementById('vs-instruction').style.display = 'block';
            document.getElementById('vs-instruction').innerText = `${TOUR.vsData.p1.name} 成績: ${time.toFixed(2)}s。換 ${TOUR.vsData.p2.name}！`;
        } else {
            TOUR.vsData.p2Time = time;
            TOUR.resolveMatch();
        }
    },

    resolveMatch: function() {
        AUDIO.playFanfare();

        let p1 = TOUR.vsData.p1;
        let p2 = TOUR.vsData.p2;
        let t1 = TOUR.vsData.p1Time;
        let t2 = TOUR.vsData.p2Time;

        p1.totalTime += t1; p1.matchesCount++;
        p2.totalTime += t2; p2.matchesCount++;

        let winner, loser;
        let winnerCardId, loserCardId;

        if (t1 < t2) { 
            winner = p1; loser = p2; 
            winnerCardId = 'vs-card-p1'; loserCardId = 'vs-card-p2';
        } else { 
            winner = p2; loser = p1; 
            winnerCardId = 'vs-card-p2'; loserCardId = 'vs-card-p1';
        }

        if (TOUR.stage === 'regular' || TOUR.stage === 'semi') {
            loser.active = false;
            if (TOUR.stage === 'semi') loser.semiLoser = true;
            if (TOUR.stage === 'semi') winner.semiWinner = true;
        } else if (TOUR.stage === 'bronze') {
            winner.finalRank = 3; loser.finalRank = 4;
            loser.active = false; winner.active = false; 
        } else if (TOUR.stage === 'final') {
            winner.finalRank = 1; loser.finalRank = 2;
        }

        APP.navTo('tour-vs'); 
        document.getElementById('btn-tour-action').style.display = 'none'; 
        document.getElementById('vs-instruction').innerText = `勝者：${winner.name}！`;

        document.getElementById(winnerCardId).classList.add('vs-winner');
        document.getElementById(loserCardId).classList.add('vs-loser');
        
        setTimeout(() => {
            TOUR.currentMatchIdx++;
            TOUR.showNextMatchVS();
        }, 4000);
    },

    checkNextStage: function() {
        if (TOUR.stage === 'final') {
            TOUR.showPodium();
            return;
        }

        if (TOUR.stage === 'semi') {
            TOUR.stage = 'bronze';
            let losers = TOUR.players.filter(p => p.semiLoser);
            TOUR.matchQueue = [{ p1: losers[0], p2: losers[1] }];
            TOUR.currentMatchIdx = 0;
            TOUR.showNextMatchVS();
            return;
        }

        if (TOUR.stage === 'bronze') {
            TOUR.stage = 'final';
            let winners = TOUR.players.filter(p => p.semiWinner);
            TOUR.matchQueue = [{ p1: winners[0], p2: winners[1] }];
            TOUR.currentMatchIdx = 0;
            TOUR.showNextMatchVS();
            return;
        }

        TOUR.setupRoundMatches();
    },

    showPodium: function() {
        AUDIO.playWin();
        let winners = [];
        if(TOUR.players.length === 0) {
            winners = [
                {name:"模擬冠軍", finalRank:1, totalTime:30, matchesCount:3},
                {name:"模擬亞軍", finalRank:2, totalTime:32, matchesCount:3},
                {name:"模擬季軍", finalRank:3, totalTime:35, matchesCount:3},
                {name:"模擬殿軍", finalRank:4, totalTime:40, matchesCount:3},
                {name:"模擬選手A", finalRank:0, totalTime:15, matchesCount:1}
            ];
        } else {
            const school = document.getElementById('input-school').value;
            const bankId = TOUR.config.bankId;
            const bankTitle = APP_DATA.banks.find(b=>b.id===bankId).title;

            winners = TOUR.players.filter(p => p.finalRank > 0);
            winners.forEach(p => {
                let avg = p.matchesCount > 0 ? (p.totalTime / p.matchesCount) : 0;
                
                APP.saveRecord({
                    player: p.name, school: school, bankId: bankId, bankTitle: bankTitle,
                    mode: 'tournament', time: p.totalTime, 
                    avgTime: avg, rounds: p.matchesCount,
                    score: p.finalRank, 
                    errors: 0
                });
            });
        }

        const podium = document.getElementById('podium-area');
        podium.innerHTML = "";
        
        let gold = winners.find(p => p.finalRank === 1);
        let silver = winners.find(p => p.finalRank === 2);
        let bronze = winners.find(p => p.finalRank === 3);
        
        const podiumData = [
            { p: gold, rank: 1, color: 'p-1' },
            { p: silver, rank: 2, color: 'p-2' },
            { p: bronze, rank: 3, color: 'p-3' }
        ];

        const displayOrder = [1, 0, 2];

        displayOrder.forEach(idx => {
            const data = podiumData[idx];
            if (data.p) {
                let crownHtml = (data.rank === 1) ? `<div class="crown-icon">👑</div>` : "";
                const bar = document.createElement('div');
                bar.className = `podium-bar ${data.color}`;
                bar.innerHTML = `
                    ${crownHtml}
                    <div class="p-name">${data.p.name}</div>
                    <div class="p-rank">${data.rank}</div>
                    <div class="pts-disp">Avg: ${(data.p.totalTime/data.p.matchesCount).toFixed(2)}s</div>
                `;
                podium.appendChild(bar);
            }
        });
        
        const listContainer = document.getElementById('podium-list');
        listContainer.innerHTML = "";
        
        let others = [];
        if(TOUR.players.length > 0) {
            others = TOUR.players.filter(p => p.finalRank !== 1 && p.finalRank !== 2 && p.finalRank !== 3);
            others.sort((a,b) => (b.matchesCount - a.matchesCount) || (a.totalTime/a.matchesCount - b.totalTime/b.matchesCount));
        } else {
            others = winners.filter(p => p.finalRank > 3);
        }

        if(others.length > 0) {
            others.forEach((p, idx) => {
                let avg = p.matchesCount > 0 ? (p.totalTime / p.matchesCount) : 0;
                const row = document.createElement('div');
                row.className = "p-row";
                row.innerHTML = `<span class="p-idx">${idx+4}</span><span class="p-n">${p.name}</span><span class="p-s">Avg: ${avg.toFixed(2)}s</span>`;
                listContainer.appendChild(row);
            });
        }

        document.querySelector('#screen-f1-podium .nav-center').innerHTML = "🏆 錦標賽 TOP 3";
        APP.navTo('f1-podium');
    }
};

// ==========================================================
// 5. 遊戲引擎
// ==========================================================
const GAME = {
    timerInterval: null, startTime: 0, cards: [], firstCard: null,
    isLocked: false, pairsLeft: 0, errors: 0,
    health: 100, lastFrameTime: 0, 
    isPaused: false, pauseStartTime: 0,
    
    lastAlarmTime: 0, 

    startPre: function() {
        AUDIO.playClick();
        if (APP.state.currentMode === 'f1') { APP.navTo('f1-setup'); return; }
        if (APP.state.currentMode === 'tournament') { APP.navTo('tour-setup'); return; }

        const schoolInput = document.getElementById('input-school');
        const nameInput = document.getElementById('input-name');
        const school = schoolInput.value.trim();
        const name = nameInput.value.trim();
        
        let isValid = true;
        if (!school) { schoolInput.classList.add('input-error'); isValid = false; }
        if (!name) { nameInput.classList.add('input-error'); isValid = false; }
        if(schoolInput.classList.contains('input-error')) schoolInput.addEventListener('animationend', () => schoolInput.classList.remove('input-error'), {once:true});
        if(nameInput.classList.contains('input-error')) nameInput.addEventListener('animationend', () => nameInput.classList.remove('input-error'), {once:true});
        if (!isValid) return; 

        APP.state.currentPlayer.name = name;
        document.getElementById('player-disp').innerText = `👤 ${name}`;
        
        const isSurv = APP.state.currentMode === 'survival';
        document.getElementById('life-bar-wrap').style.display = isSurv ? 'block' : 'none';
        document.getElementById('timer').style.color = isSurv ? '#e74c3c' : '#fff'; 
        
        document.getElementById('app-container').classList.remove('critical-alarm');

        GAME.initGrid(false);
        APP.navTo('game');
    },

    initGrid: function(isContinuation = false) {
        if(!APP_DATA.banks) return;
        const bank = APP_DATA.banks.find(b => b.id === APP.state.currentBankId);
        let allPairs = [...bank.pairs];
        allPairs.sort(() => Math.random() - 0.5); 
        const selectedPairs = allPairs.slice(0, 6); 

        let cardData = [];
        selectedPairs.forEach((item, idx) => {
            cardData.push({ id: idx, content: item.q, type: 'q', matchId: idx });
            cardData.push({ id: idx, content: item.a, type: 'a', matchId: idx });
        });
        cardData.sort(() => Math.random() - 0.5); 

        const grid = document.getElementById('game-grid');
        grid.innerHTML = "";
        grid.style.gridTemplateColumns = "repeat(3, 1fr)";
        grid.style.gridTemplateRows = "repeat(4, 1fr)";

        let fontClass = 'font-md'; 
        if (bank.id === 'b1') fontClass = 'font-lg'; 
        else if (bank.id === 'b3') fontClass = 'font-sm'; 

        cardData.forEach(d => {
            let el = document.createElement('div');
            el.className = `card ${fontClass}`;
            if (d.content.includes('/') || d.content.startsWith('data:image') || d.content.startsWith('http') || d.content.includes('器材/')) {
                el.innerHTML = `<img src="${d.content}">`;
            } else {
                el.innerText = d.content;
            }
            el.dataset.matchId = d.matchId;
            el.onclick = () => GAME.handleCardClick(el);
            grid.appendChild(el);
        });

        GAME.cards = cardData; 
        GAME.pairsLeft = selectedPairs.length; 
        GAME.firstCard = null; GAME.isLocked = false; 

        if (!isContinuation) {
            GAME.errors = 0; 
            GAME.health = 100; 
            document.getElementById('life-bar').style.width = "100%";
            document.getElementById('timer').innerText = "0.00"; 
            
            GAME.isPaused = false;
            GAME.startTime = performance.now();
            GAME.lastFrameTime = performance.now();
            GAME.startGameLoop();
        }
    },
    
    abort: function() {
        if (GAME.timerInterval) cancelAnimationFrame(GAME.timerInterval);
        GAME.timerInterval = null;
        GAME.isPaused = false;
        GAME.isLocked = false;
        document.getElementById('app-container').classList.remove('critical-alarm');
    },
    
    pause: function() {
        if (this.isPaused) return; 
        if (this.timerInterval) cancelAnimationFrame(this.timerInterval);
        this.isPaused = true;
        this.isLocked = true; 
        this.pauseStartTime = performance.now(); 
    },
    
    resume: function() {
        if (!this.isPaused) return;
        const now = performance.now();
        const pausedDuration = now - this.pauseStartTime;
        this.startTime += pausedDuration; 
        this.lastFrameTime = now; 
        
        this.isPaused = false;
        this.isLocked = false;
        this.startGameLoop();
    },

    startGameLoop: function() {
        if (GAME.timerInterval) cancelAnimationFrame(GAME.timerInterval);
        
        const loop = (timestamp) => {
            const now = performance.now();
            const diff = (now - GAME.startTime) / 1000;
            
            let deltaTime = (now - GAME.lastFrameTime) / 1000;
            if(deltaTime > 1) deltaTime = 0; 
            
            GAME.lastFrameTime = now;
            document.getElementById('timer').innerText = diff.toFixed(2);

            if (APP.state.currentMode === 'survival') {
                GAME.health -= 4 * deltaTime;
                const visualHealth = Math.max(0, GAME.health);
                document.getElementById('life-bar').style.width = visualHealth + "%";
                
                const appCont = document.getElementById('app-container');
                if (visualHealth < 20 && visualHealth > 0) {
                    if(!appCont.classList.contains('critical-alarm')) appCont.classList.add('critical-alarm');
                    
                    if (now - GAME.lastAlarmTime > 500) { 
                        AUDIO.playAlarm();
                        GAME.lastAlarmTime = now;
                    }

                } else {
                    appCont.classList.remove('critical-alarm');
                }

                if (GAME.health <= 0) { GAME.endGame(false); return; }
            }
            GAME.timerInterval = requestAnimationFrame(loop);
        };
        GAME.timerInterval = requestAnimationFrame(loop);
    },

    handleCardClick: function(el) {
        if (GAME.isLocked) return;
        if (el.classList.contains('active') || el.classList.contains('matched')) return;
        el.classList.add('active');
        AUDIO.playFlip(); 

        if (!GAME.firstCard) {
            GAME.firstCard = el;
        } else {
            GAME.isLocked = true;
            const match1 = GAME.firstCard.dataset.matchId;
            const match2 = el.dataset.matchId;
            if (match1 === match2) {
                GAME.pairsLeft--;
                AUDIO.playMatch(); 
                setTimeout(() => {
                    GAME.firstCard.classList.add('matched');
                    el.classList.add('matched');
                    GAME.resetTurn();
                    if (GAME.pairsLeft === 0) {
                        if (APP.state.currentMode === 'survival') {
                            GAME.health = Math.min(100, GAME.health + 15);
                            GAME.initGrid(true); 
                        } else {
                            GAME.endGame(true); 
                        }
                    }
                }, 200);
            } else {
                GAME.errors++;
                AUDIO.playError(); 
                GAME.firstCard.classList.add('error');
                el.classList.add('error');
                
                if (APP.state.currentMode === 'survival') {
                    GAME.health -= 8;
                    const bar = document.getElementById('life-bar');
                    bar.style.backgroundColor = '#fff';
                    setTimeout(() => bar.style.backgroundColor = '#e74c3c', 100);
                } else if (APP.state.currentMode === 'standard' || APP.state.currentMode === 'tournament') {
                    GAME.startTime -= 1000; 
                    triggerRedFlash();
                } else if (APP.state.currentMode === 'f1') {
                    GAME.startTime -= 2000; 
                    triggerRedFlash();
                }

                setTimeout(() => {
                    GAME.firstCard.classList.remove('active', 'error');
                    el.classList.remove('active', 'error');
                    GAME.resetTurn();
                }, 500);
            }
        }
    },

    resetTurn: function() { GAME.firstCard = null; GAME.isLocked = false; },

    endGame: function(isWin) {
        cancelAnimationFrame(GAME.timerInterval);
        document.getElementById('app-container').classList.remove('critical-alarm'); // Reset alarm
        const finalTime = document.getElementById('timer').innerText;
        const timeVal = parseFloat(finalTime);
        
        if (isWin) AUDIO.playWin(); 

        if (APP.state.currentMode === 'f1') { F1.handleGameEnd(timeVal, GAME.errors); return; }
        if (APP.state.currentMode === 'tournament') { TOUR.handleGameEnd(timeVal, GAME.errors); return; }
        
        if (APP.state.currentMode === 'survival') {
             document.getElementById('res-score').innerText = finalTime + "s";
             document.getElementById('res-detail').innerText = `生存時間 (錯誤: ${GAME.errors})`;
             APP.saveRecord({ time: timeVal, score: 0, errors: GAME.errors });
        } else if (isWin) {
            document.getElementById('res-score').innerText = finalTime + "s";
            document.getElementById('res-detail').innerText = `錯誤次數：${GAME.errors}`;
            APP.saveRecord({ time: timeVal, score: 6, errors: GAME.errors });
        } else {
            APP.navTo('input'); return;
        }
        APP.navTo('result');
    },
    retry: function() { GAME.startPre(); }
};

function triggerRedFlash() {
    const timerEl = document.getElementById('timer');
    timerEl.classList.remove('timer-penalty');
    void timerEl.offsetWidth; 
    timerEl.classList.add('timer-penalty');
}

// 啟動入口
window.onload = APP.init;