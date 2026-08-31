// ============================================================
//  GLOBAL STATE & CONFIGURATION
// ============================================================
let currentMode = 'visitor';
let currentStudentId = null;
let currentDocumentType = null;
let currentGuardianType = null;
let selectedFile = null;
let isAdminLoggedIn = false;

// ค่าคอนฟิกเริ่มต้นของระบบ (Default Configuration)
const DEFAULT_CONFIG = {
    scriptUrl: 'https://script.google.com/macros/s/AKfycbyIlRF-pGuWbPqRPtvIqUjMluAZHKWwtnkMroexHlbmGUfbs0bxBbcFY_s-KIghGxlJBg/exec',
    spreadsheetId: '1kt0l2eKCbKvYvtLtnhDAleolzpxFB4fos6ZNQ87bDB0',
    documentsFolderId: '12CwpLW7vAf1492osJZSraprBJFaH9ItV',
    sheetName: 'Students'
};

// ตัวจัดการการตั้งค่าระบบ (Configuration Manager)
const ConfigManager = {
    STORAGE_KEY: 'app_system_config',
    current: { ...DEFAULT_CONFIG },

    init() {
        this.load();
    },

    load() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                this.current = {
                    scriptUrl: parsed.scriptUrl ? parsed.scriptUrl.trim() : DEFAULT_CONFIG.scriptUrl,
                    spreadsheetId: parsed.spreadsheetId ? parsed.spreadsheetId.trim() : DEFAULT_CONFIG.spreadsheetId,
                    documentsFolderId: parsed.documentsFolderId ? parsed.documentsFolderId.trim() : DEFAULT_CONFIG.documentsFolderId,
                    sheetName: parsed.sheetName ? parsed.sheetName.trim() : DEFAULT_CONFIG.sheetName
                };
            } else {
                this.current = { ...DEFAULT_CONFIG };
            }
        } catch (e) {
            this.current = { ...DEFAULT_CONFIG };
        }
        SCRIPT_URL = this.current.scriptUrl;
        return this.current;
    },

    save(config) {
        const clean = {
            scriptUrl: (config.scriptUrl || DEFAULT_CONFIG.scriptUrl).trim(),
            spreadsheetId: this.extractSpreadsheetId(config.spreadsheetId) || DEFAULT_CONFIG.spreadsheetId,
            documentsFolderId: this.extractFolderId(config.documentsFolderId) || DEFAULT_CONFIG.documentsFolderId,
            sheetName: (config.sheetName || DEFAULT_CONFIG.sheetName).trim()
        };
        this.current = clean;
        SCRIPT_URL = clean.scriptUrl;
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(clean));
        } catch (e) {}
        return clean;
    },

    reset() {
        this.current = { ...DEFAULT_CONFIG };
        SCRIPT_URL = DEFAULT_CONFIG.scriptUrl;
        try {
            localStorage.removeItem(this.STORAGE_KEY);
        } catch (e) {}
        return this.current;
    },

    getScriptUrl() {
        return this.current.scriptUrl || DEFAULT_CONFIG.scriptUrl;
    },

    getSpreadsheetId() {
        return this.current.spreadsheetId || DEFAULT_CONFIG.spreadsheetId;
    },

    getDocumentsFolderId() {
        return this.current.documentsFolderId || DEFAULT_CONFIG.documentsFolderId;
    },

    getSheetName() {
        return this.current.sheetName || DEFAULT_CONFIG.sheetName;
    },

    // สกัด Google Spreadsheet ID จาก URL หรือข้อความ
    extractSpreadsheetId(input) {
        if (!input) return '';
        const trimmed = input.trim();
        const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (match && match[1]) return match[1];
        if (!trimmed.includes('/') && trimmed.length > 10) return trimmed;
        return trimmed;
    },

    // สกัด Google Drive Folder ID จาก URL หรือข้อความ
    extractFolderId(input) {
        if (!input) return '';
        const trimmed = input.trim();
        const match = trimmed.match(/\/folders\/([a-zA-Z0-9-_]+)/);
        if (match && match[1]) return match[1];
        const matchOpen = trimmed.match(/[?&]id=([a-zA-Z0-9-_]+)/);
        if (matchOpen && matchOpen[1]) return matchOpen[1];
        if (!trimmed.includes('/') && trimmed.length > 10) return trimmed;
        return trimmed;
    }
};

let SCRIPT_URL = ConfigManager.getScriptUrl();

// ============================================================
//  STORAGE & IN-MEMORY CACHE (0ms Instant Load)
// ============================================================
const StorageCache = {
    memory: new Map(),
    get(key) {
        if (this.memory.has(key)) return this.memory.get(key);
        try {
            const raw = localStorage.getItem('app_cache_' + key);
            if (!raw) return null;
            const item = JSON.parse(raw);
            if (item.expiry && Date.now() > item.expiry) {
                return null;
            }
            this.memory.set(key, item.data);
            return item.data;
        } catch (e) {
            return null;
        }
    },
    getInstant(key) {
        if (this.memory.has(key)) return this.memory.get(key);
        try {
            const raw = localStorage.getItem('app_cache_' + key);
            if (!raw) return null;
            const item = JSON.parse(raw);
            return item.data; // Return immediately even if expired for instant 0ms UI rendering
        } catch (e) {
            return null;
        }
    },
    set(key, data, ttlSeconds = 300) {
        this.memory.set(key, data);
        try {
            const item = {
                data: data,
                expiry: ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null,
                timestamp: Date.now()
            };
            localStorage.setItem('app_cache_' + key, JSON.stringify(item));
        } catch (e) {}
    },
    delete(key) {
        this.memory.delete(key);
        try {
            localStorage.removeItem('app_cache_' + key);
        } catch (e) {}
    },
    clear() {
        this.memory.clear();
        try {
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith('app_cache_')) localStorage.removeItem(k);
            });
        } catch (e) {}
    }
};

const cache = StorageCache; // Backward compatibility

// Admin table state
let allStudents = [];
let filteredStudents = [];
let currentPage = 1;
const pageSize = 50;

// ============================================================
//  UTILITY FUNCTIONS
// ============================================================
function showAlert(type, message, duration = 5000) {
    const container = document.getElementById('alertContainer');
    const div = document.createElement('div');
    div.className = `alert alert-${type}`;
    const iconMap = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    div.innerHTML = `<i class="fas ${iconMap[type] || 'fa-info-circle'}"></i> ${message}`;
    container.appendChild(div);
    setTimeout(() => {
        div.style.opacity = '0';
        div.style.transform = 'translateX(40px)';
        setTimeout(() => div.remove(), 300);
    }, duration);
}

function showLoading(show) {
    document.getElementById('loadingOverlay').classList.toggle('active', show);
}

function getDocTypeName(docType, guardian = null) {
    const map = {
        studentIdCard: 'สำเนาบัตรประชาชนนักศึกษา',
        studentHouseReg: 'สำเนาทะเบียนบ้านนักศึกษา',
        studentTranscript: 'ใบผลการเรียน (ปพ. / Transcript)',
        studentNameChange: 'ใบสำคัญการเปลี่ยนชื่อ-สกุล',
        studentGradCert: 'วุฒิการศึกษาเดิม / ประกาศนียบัตร',
        studentBirthCert: 'สูติบัตร / ใบเกิด',
        guardianIdCard: 'สำเนาบัตรประชาชนผู้ปกครอง',
        guardianHouseReg: 'สำเนาทะเบียนบ้านผู้ปกครอง'
    };
    let name = map[docType] || docType;
    if (guardian) {
        const g = { father: 'พ่อ', mother: 'แม่', other: 'ผู้ปกครองอื่นๆ' };
        name += ` (${g[guardian] || guardian})`;
    }
    return name;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
    });
}

function compressImageFile(file, maxWidth = 1600, maxHeight = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            // ไฟล์ที่ไม่ใช่รูปภาพ (เช่น PDF) -> แปลงเป็น Base64 โดยตรง
            fileToBase64(file).then(base64 => {
                resolve({
                    base64: base64,
                    contentType: file.type,
                    originalSize: file.size,
                    compressedSize: file.size,
                    isImage: false,
                    reduction: 0
                });
            }).catch(reject);
            return;
        }

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                // คำนวณสัดส่วนรูปภาพให้พอดีกับ maxWidth x maxHeight
                if (width > maxWidth || height > maxHeight) {
                    if (width / height > maxWidth / maxHeight) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    } else {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // ส่งออกเป็น JPEG คุณภาพสูงแต่ขนาดไฟล์เล็กลงมาก
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                const base64 = dataUrl.split(',')[1];
                const compressedSize = Math.round((base64.length * 3) / 4);

                resolve({
                    base64: base64,
                    contentType: 'image/jpeg',
                    originalSize: file.size,
                    compressedSize: compressedSize,
                    isImage: true,
                    reduction: Math.max(0, Math.round(((file.size - compressedSize) / file.size) * 100))
                });
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

function clearFileSelection() {
    document.getElementById('fileInput').value = '';
    document.getElementById('filePreview').style.display = 'none';
    selectedFile = null;
    preparedUploadData = null;
}

function getSampleStudents() {
    return [
        { id: '26737', name: 'นายธนะชัย บำรุงราษฏร์', level: 'ปวช.1', major: 'ช่างไฟฟ้า', class: 'ปวช.ช่างไฟฟ้า',
            shift: 'เช้า', docs: '4/8' },
        { id: '26767', name: 'นายไพสิฐ สุนทรเทพวรากุล', level: 'ปวช.1', major: 'ช่างไฟฟ้า', class: 'ชฟ.1',
            shift: 'เช้า', docs: '4/8' },
        { id: '26787', name: 'นายเพชรเกล้า ภูทองเทียม', level: 'ปวช.1', major: 'ช่างไฟฟ้า', class: 'ชฟ.1',
            shift: 'เช้า', docs: '8/8' },
        { id: '26466', name: 'นายจักรินทร์ แดนโคตรผม', level: 'ปวช.2', major: 'ช่างไฟฟ้า', class: 'ชฟ.2',
            shift: 'เช้า', docs: '2/8' },
        { id: '25883', name: 'นายณัฐพล บุญลือ', level: 'ปวส.1', major: 'ไฟฟ้า', class: 'ชฟ.1/1', shift: 'เช้า',
            docs: '0/8' }
    ];
}

// ============================================================
//  REAL-TIME SYNCHRONIZATION ENGINE
// ============================================================
const RealTimeEngine = {
    currentVersion: null,
    syncIntervalTimer: null,
    isSyncing: false,
    syncIntervalMs: 25000, // ตรวจสอบความเปลี่ยนแปลงทุก 25 วินาที

    init() {
        this.startAutoSync();
        this.setupVisibilityListeners();
    },

    startAutoSync() {
        if (this.syncIntervalTimer) clearInterval(this.syncIntervalTimer);
        this.syncIntervalTimer = setInterval(() => {
            this.checkVersionAndSync();
        }, this.syncIntervalMs);
    },

    setupVisibilityListeners() {
        // เมื่อผู้ใช้สลับกลับมาที่หน้าเว็บ ให้เช็คอัปเดตทันทีแบบ Real-time
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkVersionAndSync();
            }
        });
        window.addEventListener('focus', () => {
            this.checkVersionAndSync();
        });
    },

    async checkVersionAndSync() {
        if (this.isSyncing) return;
        try {
            this.isSyncing = true;
            const res = await callAPI(`${SCRIPT_URL}?action=checkDataVersion&_=${Date.now()}`, { timeout: 8000 }, 0);
            if (res && res.success && res.data) {
                const serverVer = res.data.version || res.version;
                if (this.currentVersion && serverVer && serverVer !== this.currentVersion) {
                    console.log(`[RealTimeSync] ตรวจพบข้อมูลเปลี่ยนแปลงบนเซิร์ฟเวอร์ (Ver: ${serverVer}) ดึงข้อมูลล่าสุดทันที...`);
                    this.currentVersion = serverVer;
                    await loadDashboardData(true, true); // background silent update
                    this.updateConnectionStatusBadge('ออนไลน์ • ซิงค์เรียลไทม์');
                } else if (serverVer) {
                    this.currentVersion = serverVer;
                    this.updateConnectionStatusBadge('ออนไลน์');
                }
            }
        } catch (e) {
            // ไม่แสดง alert รบกวนเมื่อ background polling
        } finally {
            this.isSyncing = false;
        }
    },

    updateConnectionStatusBadge(statusText) {
        const statusDot = document.getElementById('statusDot');
        const connStatus = document.getElementById('connectionStatus');
        if (statusDot) statusDot.className = 'dot online';
        if (connStatus) {
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            connStatus.textContent = `${statusText} (${timeStr})`;
        }
    }
};

// ============================================================
//  API FUNCTIONS (High Performance & Auto-Retry)
// ============================================================
const inflightRequests = new Map();

async function callAPI(url, options = {}, retries = 1) {
    const method = options.method || 'GET';
    const timeoutMs = options.timeout || (options.body && options.body.fileData ? 60000 : 30000);
    
    // ป้องกัน GET request ซ้ำซ้อนพร้อมๆ กัน (In-flight deduplication)
    const requestKey = method === 'GET' ? url : null;
    if (requestKey && inflightRequests.has(requestKey)) {
        return inflightRequests.get(requestKey);
    }

    const executeFetch = async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            let res;
            if (method === 'POST' && options.body) {
                // ส่ง JSON ผ่าน Content-Type text/plain เพื่อป้องกัน CORS preflight และให้ GAS อ่านได้ทันที
                res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(options.body),
                    redirect: 'follow',
                    signal: controller.signal
                });
            } else {
                res = await fetch(url, {
                    method: 'GET',
                    redirect: 'follow',
                    signal: controller.signal
                });
            }
            clearTimeout(timeout);
            
            const text = await res.text();
            
            // ตรวจสอบว่าผลลัพธ์เป็น HTML error page ของ Google หรือไม่
            if (text.trim().startsWith('<!DOCTYPE') || text.includes('<html')) {
                throw new Error('Google Apps Script ส่งกลับ HTML (อาจต้องตรวจสอบสิทธิ์หรือลิงก์ Web App)');
            }
            
            try {
                const parsed = JSON.parse(text);
                // บันทึก data version ที่ได้รับ
                if (parsed && (parsed.version || (parsed.data && parsed.data.version))) {
                    RealTimeEngine.currentVersion = parsed.version || parsed.data.version;
                }
                return parsed;
            } catch (parseErr) {
                throw new Error('ตอบกลับไม่ใช่รูปแบบ JSON: ' + text.substring(0, 150));
            }
        } catch (err) {
            clearTimeout(timeout);
            const isAbort = err.name === 'AbortError';
            const errorMsg = isAbort ? `หมดเวลาเชื่อมต่อ (${Math.round(timeoutMs/1000)}s)` : err.message;
            
            // ลองใหม่ 1 ครั้ง (Auto-retry) กรณีเน็ตสะดุดหรือ Cold start ของ GAS
            if (retries > 0 && (isAbort || err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
                console.warn(`[API Retry] กำลังลองใหม่... (${errorMsg})`);
                await new Promise(r => setTimeout(r, 800));
                return callAPI(url, options, retries - 1);
            }
            
            throw new Error(errorMsg);
        }
    };

    const promise = executeFetch();
    if (requestKey) {
        inflightRequests.set(requestKey, promise);
        promise.finally(() => inflightRequests.delete(requestKey));
    }
    return promise;
}

// โหลดข้อมูล Dashboard รวมทั้งนักศึกษาและสถิติใน 1 API Call (ความเร็วสูงสุด & Real-time SWR)
async function loadDashboardData(force = false, silent = false) {
    // 1. ลองดึงข้อมูลจาก LocalStorage ทันที (0ms Instant Load)
    if (!force) {
        const instantData = StorageCache.getInstant('dashboard_data');
        if (instantData) {
            allStudents = instantData.students || [];
            applyFiltersAndRender(currentPage);
            if (instantData.statistics) {
                renderStats(instantData.statistics);
                renderClassDist(instantData.statistics);
            }
            // ถ้าแคชยังไม่หมดอายุ ไม่ต้องยิงเน็ตซ้ำ
            if (StorageCache.get('dashboard_data')) {
                return { success: true, data: instantData };
            }
        }
    }

    try {
        if (!allStudents.length && !silent) showLoading(true);
        const result = await callAPI(`${SCRIPT_URL}?action=getDashboardData&_=${Date.now()}`);
        if (result && result.success && result.data) {
            const data = result.data;
            allStudents = data.students || [];
            if (result.version) RealTimeEngine.currentVersion = result.version;
            StorageCache.set('dashboard_data', data, 300); // แคช 5 นาที
            applyFiltersAndRender(currentPage);
            if (data.statistics) {
                renderStats(data.statistics);
                renderClassDist(data.statistics);
            }
            RealTimeEngine.updateConnectionStatusBadge('ออนไลน์ • ล่าสุด');
            return result;
        } else {
            // Fallback ถ้าเป็น backend เวอร์ชันเก่าที่ยังไม่มี getDashboardData
            return await fallbackLoadData();
        }
    } catch (err) {
        console.warn('Load dashboard error, using fallback:', err);
        if (!allStudents.length) {
            return await fallbackLoadData();
        }
    } finally {
        if (!silent) showLoading(false);
    }
}

async function fallbackLoadData() {
    try {
        const [studentsRes, statsRes] = await Promise.allSettled([
            callAPI(`${SCRIPT_URL}?action=getAllStudents&_=${Date.now()}`),
            callAPI(`${SCRIPT_URL}?action=getStatistics&_=${Date.now()}`)
        ]);
        if (studentsRes.status === 'fulfilled' && studentsRes.value?.success) {
            allStudents = studentsRes.value.data || [];
            applyFiltersAndRender(1);
        } else if (!allStudents.length) {
            allStudents = getSampleStudents();
            applyFiltersAndRender(1);
        }
        if (statsRes.status === 'fulfilled' && statsRes.value?.success) {
            renderStats(statsRes.value.data);
            renderClassDist(statsRes.value.data);
        }
    } catch(e) {
        if (!allStudents.length) {
            allStudents = getSampleStudents();
            applyFiltersAndRender(1);
        }
    }
}

async function searchStudentWithCache(query) {
    const key = 'search_' + query.trim().toLowerCase();
    const cached = StorageCache.get(key);
    if (cached) return cached;
    const result = await callAPI(`${SCRIPT_URL}?action=searchStudent&query=${encodeURIComponent(query)}`);
    if (result && result.success) StorageCache.set(key, result, 600); // แคช 10 นาที
    return result;
}

async function loadAllStudents(force = false) {
    if (!force) {
        const cached = StorageCache.get('all_students');
        if (cached) return cached;
    }
    const result = await callAPI(`${SCRIPT_URL}?action=getAllStudents&_=${Date.now()}`);
    if (result && result.success) StorageCache.set('all_students', result, 300);
    return result;
}

// ============================================================
//  VISITOR MODE
// ============================================================
async function searchStudent() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) return showAlert('error', 'กรุณาป้อนรหัสหรือชื่อ');
    
    // ค้นหาในหน่วยความจำทันที (0ms Instant Local Search)
    const qLower = query.toLowerCase();
    const localMatch = allStudents.find(s => 
        (s.id && s.id.toString().toLowerCase() === qLower) ||
        (s.name && s.name.toLowerCase().includes(qLower))
    );
    
    if (localMatch) {
        currentStudentId = localMatch.id;
        document.getElementById('studentId').textContent = localMatch.id;
        document.getElementById('studentName').textContent = localMatch.name;
        document.getElementById('educationLevel').textContent = localMatch.level || '-';
        document.getElementById('major').textContent = localMatch.major || '-';
        document.getElementById('studentClass').textContent = localMatch.class || '-';
        document.getElementById('shift').textContent = localMatch.shift || '-';
        document.getElementById('studentData').style.display = 'block';
    }

    try {
        if (!localMatch) showLoading(true);
        const result = await searchStudentWithCache(query);
        if (result.success) {
            displayStudent(result.data);
            document.getElementById('studentData').style.display = 'block';
            currentStudentId = result.data.studentId;
            showAlert('success', 'พบข้อมูลนักศึกษา');
        } else {
            if (!localMatch) {
                showAlert('error', result.message || 'ไม่พบข้อมูล');
                document.getElementById('studentData').style.display = 'none';
            }
        }
    } catch (err) {
        if (!localMatch) showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function displayStudent(data) {
    document.getElementById('studentId').textContent = data.studentId;
    document.getElementById('studentName').textContent = data.studentName;
    document.getElementById('educationLevel').textContent = data.educationLevel;
    document.getElementById('major').textContent = data.major;
    document.getElementById('studentClass').textContent = data.class || '-';
    document.getElementById('shift').textContent = data.shift || '-';

    const docs = data.documents || {};

    function renderGrid(containerId, items) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = items.map(({ docType, guardian, label, icon }) => {
            let doc = docs[docType];
            if (guardian && docs[docType] && docs[docType][guardian]) {
                doc = docs[docType][guardian];
            } else if (guardian) {
                doc = null;
            }
            const uploaded = doc && doc.uploaded;
            return `
                <div class="doc-card">
                    <div class="doc-card-header">
                        <i class="fas ${icon}"></i>
                        <h4>${label}</h4>
                    </div>
                    <div class="doc-card-body">
                        <span class="status-pill ${uploaded ? 'uploaded' : 'missing'}">
                            <i class="fas ${uploaded ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                            ${uploaded ? 'อัปโหลดแล้ว' : 'ยังไม่ได้อัปโหลด'}
                        </span>
                    </div>
                    <div class="doc-card-footer">
                        <button class="btn btn-primary btn-sm" onclick="viewDocument('${docType}','${guardian || ''}')"><i class="fas fa-eye"></i> ดู</button>
                        <button class="btn btn-success btn-sm" onclick="openUploadModal('${docType}','${guardian || ''}')"><i class="fas fa-upload"></i> อัปโหลด</button>
                        ${uploaded ? `<button class="btn btn-danger btn-sm" onclick="deleteDocumentDirect('${data.studentId}','${docType}','${guardian || ''}')" title="ลบเอกสารนี้"><i class="fas fa-trash"></i> ลบ</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderGrid('studentDocsGrid', [
        { docType: 'studentIdCard', label: 'สำเนาบัตรประชาชน', icon: 'fa-id-card' },
        { docType: 'studentHouseReg', label: 'สำเนาทะเบียนบ้าน', icon: 'fa-home' },
        { docType: 'studentTranscript', label: 'ใบผลการเรียน (ปพ.)', icon: 'fa-graduation-cap' },
        { docType: 'studentNameChange', label: 'ใบเปลี่ยนชื่อ-สกุล', icon: 'fa-file-signature' },
        { docType: 'studentGradCert', label: 'วุฒิการศึกษาเดิม', icon: 'fa-award' },
        { docType: 'studentBirthCert', label: 'สูติบัตร / ใบเกิด', icon: 'fa-baby' }
    ]);
    renderGrid('fatherDocsGrid', [
        { docType: 'guardianIdCard', guardian: 'father', label: 'บัตรประชาชนพ่อ', icon: 'fa-male' },
        { docType: 'guardianHouseReg', guardian: 'father', label: 'ทะเบียนบ้านพ่อ', icon: 'fa-house-user' }
    ]);
    renderGrid('motherDocsGrid', [
        { docType: 'guardianIdCard', guardian: 'mother', label: 'บัตรประชาชนแม่', icon: 'fa-female' },
        { docType: 'guardianHouseReg', guardian: 'mother', label: 'ทะเบียนบ้านแม่', icon: 'fa-house-user' }
    ]);
    renderGrid('otherDocsGrid', [
        { docType: 'guardianIdCard', guardian: 'other', label: 'บัตรประชาชนผู้ปกครองอื่น', icon: 'fa-user-tie' },
        { docType: 'guardianHouseReg', guardian: 'other', label: 'ทะเบียนบ้านผู้ปกครองอื่น', icon: 'fa-house-user' }
    ]);

    renderExtraDocsGrid(data.documents ? (data.documents.extraDocs || []) : [], data.studentId || data.id);
}

function renderExtraDocsGrid(extraDocs, studentId) {
    const container = document.getElementById('extraDocsGrid');
    if (!container) return;

    if (!extraDocs || extraDocs.length === 0) {
        container.innerHTML = `
            <div class="extra-doc-empty">
                <i class="fas fa-folder-open" style="font-size:2rem; color:var(--text-muted); margin-bottom:8px; display:block;"></i>
                ยังไม่มีเอกสารเพิ่มเติมสำหรับนักศึกษาคนนี้<br/>
                <span style="font-size:0.8rem; color:var(--text-secondary);">กดปุ่ม <strong>"➕ อัปโหลดเอกสารเพิ่มเติม"</strong> เพื่อเพิ่มเอกสาร</span>
            </div>
        `;
        return;
    }

    container.innerHTML = extraDocs.map(doc => {
        let uploadDate = '';
        try {
            if (doc.uploadedAt) {
                uploadDate = new Date(doc.uploadedAt).toLocaleDateString('th-TH', { dateStyle: 'medium' });
            }
        } catch(e) {}

        return `
            <div class="extra-doc-card">
                <div class="extra-doc-header">
                    <div class="extra-doc-icon"><i class="fas fa-file-alt"></i></div>
                    <div class="extra-doc-info">
                        <div class="extra-doc-title">${doc.title || 'เอกสารเพิ่มเติม'}</div>
                        <div class="extra-doc-meta">${doc.fileName || ''} ${uploadDate ? `• ${uploadDate}` : ''}</div>
                    </div>
                </div>
                <div class="extra-doc-actions">
                    <button class="btn btn-primary btn-xs" onclick="viewExtraDoc('${doc.fileName || ''}', '${encodeURIComponent(doc.title || '')}')">
                        <i class="fas fa-eye"></i> ดูเอกสาร
                    </button>
                    <button class="btn btn-danger btn-xs" onclick="deleteExtraDoc('${studentId || currentStudentId}','${doc.id}','${doc.title || ''}')" title="ลบเอกสารนี้">
                        <i class="fas fa-trash"></i> ลบ
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
//  UPLOAD
// ============================================================
let preparedUploadData = null;

function openUploadModal(docType, guardian = null) {
    if (!currentStudentId) return showAlert('error', 'กรุณาค้นหานักศึกษาก่อน');
    currentDocumentType = docType;
    currentGuardianType = guardian;
    document.getElementById('uploadModalTitle').textContent = 'อัปโหลด ' + getDocTypeName(docType, guardian);
    document.getElementById('documentType').value = docType;
    const gGroup = document.getElementById('guardianTypeGroup');
    if (docType === 'guardianIdCard' || docType === 'guardianHouseReg') {
        gGroup.style.display = 'block';
        if (guardian) document.getElementById('modalGuardianType').value = guardian;
    } else {
        gGroup.style.display = 'none';
    }
    document.getElementById('fileInput').value = '';
    document.getElementById('filePreview').style.display = 'none';
    selectedFile = null;
    preparedUploadData = null;
    document.getElementById('uploadModal').classList.add('active');
}

function closeUploadModal() {
    document.getElementById('uploadModal').classList.remove('active');
    preparedUploadData = null;
}

async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const valid = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!valid.includes(file.type)) return showAlert('error', 'กรุณาเลือก PDF หรือรูปภาพ (JPG, PNG, WebP)');
    if (file.size > 25 * 1024 * 1024) return showAlert('error', 'ขนาดไฟล์ต้นฉบับต้องไม่เกิน 25MB');
    
    selectedFile = file;
    const fileNameEl = document.getElementById('fileName');
    fileNameEl.innerHTML = `<i class="fas fa-file"></i> ${file.name} (${formatFileSize(file.size)}) <span style="color:var(--primary);"><i class="fas fa-spinner fa-spin"></i> กำลังเตรียมไฟล์...</span>`;
    document.getElementById('filePreview').style.display = 'block';

    try {
        const comp = await compressImageFile(file);
        preparedUploadData = comp;
        
        let badgeHtml = '';
        if (comp.isImage && comp.reduction > 0) {
            badgeHtml = `<br/><span class="compression-badge"><i class="fas fa-bolt"></i> บีบอัดอัตโนมัติ: ${formatFileSize(comp.originalSize)} ➔ ${formatFileSize(comp.compressedSize)} (ลดลง ${comp.reduction}%)</span>`;
        }
        fileNameEl.innerHTML = `<i class="fas fa-file-check" style="color:var(--success);"></i> ${file.name} ${badgeHtml}`;
        showAlert('success', 'เลือกไฟล์พร้อมอัปโหลด: ' + file.name);
    } catch (err) {
        preparedUploadData = null;
        fileNameEl.textContent = `${file.name} (${formatFileSize(file.size)})`;
        showAlert('warning', 'พร้อมอัปโหลดไฟล์ต้นฉบับ');
    }
}

async function confirmUpload() {
    if (!selectedFile) return showAlert('error', 'กรุณาเลือกไฟล์');
    if (!currentStudentId) return showAlert('error', 'ไม่พบรหัสนักศึกษา');
    try {
        showLoading(true);
        let base64 = preparedUploadData ? preparedUploadData.base64 : await fileToBase64(selectedFile);
        let contentType = preparedUploadData ? preparedUploadData.contentType : selectedFile.type;
        
        const payload = {
            action: 'uploadDocument',
            studentId: currentStudentId,
            documentType: currentDocumentType,
            filename: selectedFile.name,
            fileData: base64,
            contentType: contentType
        };
        if (currentDocumentType === 'guardianIdCard' || currentDocumentType === 'guardianHouseReg') {
            payload.guardianType = document.getElementById('modalGuardianType').value;
        }
        const result = await callAPI(SCRIPT_URL, { method: 'POST', body: payload });
        if (result.success) {
            closeUploadModal();
            showAlert('success', '✅ อัปโหลดเอกสารสำเร็จ (ความเร็วสูง & ซิงค์เรียลไทม์)');
            // ล้าง cache แล้ว reload ข้อมูลที่แสดงอยู่
            cache.delete('search_' + currentStudentId);
            StorageCache.delete('dashboard_data');
            
            if (currentMode === 'visitor' && currentStudentId) {
                try {
                    const refreshResult = await callAPI(
                        `${SCRIPT_URL}?action=searchStudent&query=${encodeURIComponent(currentStudentId)}`
                    );
                    if (refreshResult.success) {
                        displayStudent(refreshResult.data);
                        document.getElementById('studentData').style.display = 'block';
                    }
                } catch (e) { }
            }
            if (currentMode === 'admin') {
                cache.delete('all_students');
                await loadStudentsTable();
                await loadStatistics();
            }
        } else {
            showAlert('error', result.message || 'อัปโหลดล้มเหลว');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

// ============================================================
//  EXTRA DOCUMENTS MANAGEMENT
// ============================================================
let preparedExtraUploadData = null;
let selectedExtraFile = null;

function openUploadExtraDocModal() {
    if (!currentStudentId) return showAlert('error', 'กรุณาค้นหานักศึกษาก่อน');
    document.getElementById('extraDocTitleInput').value = '';
    document.getElementById('extraDocFileInput').value = '';
    document.getElementById('extraDocFilePreview').style.display = 'none';
    selectedExtraFile = null;
    preparedExtraUploadData = null;
    document.getElementById('uploadExtraDocModal').classList.add('active');
}

function closeUploadExtraDocModal() {
    document.getElementById('uploadExtraDocModal').classList.remove('active');
    selectedExtraFile = null;
    preparedExtraUploadData = null;
}

async function handleExtraDocFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const valid = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!valid.includes(file.type)) return showAlert('error', 'กรุณาเลือก PDF หรือรูปภาพ (JPG, PNG, WebP)');
    if (file.size > 25 * 1024 * 1024) return showAlert('error', 'ขนาดไฟล์ต้นฉบับต้องไม่เกิน 25MB');
    
    selectedExtraFile = file;
    const fileNameEl = document.getElementById('extraDocFileName');
    fileNameEl.innerHTML = `<i class="fas fa-file"></i> ${file.name} (${formatFileSize(file.size)}) <span style="color:var(--primary);"><i class="fas fa-spinner fa-spin"></i> กำลังเตรียมไฟล์...</span>`;
    document.getElementById('extraDocFilePreview').style.display = 'block';

    try {
        const comp = await compressImageFile(file);
        preparedExtraUploadData = comp;
        
        let badgeHtml = '';
        if (comp.isImage && comp.reduction > 0) {
            badgeHtml = `<br/><span class="compression-badge"><i class="fas fa-bolt"></i> บีบอัดอัตโนมัติ: ${formatFileSize(comp.originalSize)} ➔ ${formatFileSize(comp.compressedSize)} (ลดลง ${comp.reduction}%)</span>`;
        }
        fileNameEl.innerHTML = `<i class="fas fa-file-check" style="color:var(--success);"></i> ${file.name} ${badgeHtml}`;
        showAlert('success', 'เลือกไฟล์พร้อมอัปโหลด: ' + file.name);
    } catch (err) {
        preparedExtraUploadData = null;
        fileNameEl.textContent = `${file.name} (${formatFileSize(file.size)})`;
        showAlert('warning', 'พร้อมอัปโหลดไฟล์ต้นฉบับ');
    }
}

async function confirmUploadExtraDoc() {
    const title = document.getElementById('extraDocTitleInput').value.trim();
    if (!title) return showAlert('error', 'กรุณากรอกชื่อหรือรายละเอียดเอกสาร');
    if (!selectedExtraFile) return showAlert('error', 'กรุณาเลือกไฟล์');
    if (!currentStudentId) return showAlert('error', 'ไม่พบรหัสนักศึกษา');

    try {
        showLoading(true);
        let base64 = preparedExtraUploadData ? preparedExtraUploadData.base64 : await fileToBase64(selectedExtraFile);
        let contentType = preparedExtraUploadData ? preparedExtraUploadData.contentType : selectedExtraFile.type;
        
        const payload = {
            action: 'uploadExtraDocument',
            studentId: currentStudentId,
            title: title,
            filename: selectedExtraFile.name,
            fileData: base64,
            contentType: contentType
        };

        const result = await callAPI(SCRIPT_URL, { method: 'POST', body: payload });
        if (result.success) {
            closeUploadExtraDocModal();
            showAlert('success', `✅ อัปโหลดเอกสารเพิ่มเติม "${title}" สำเร็จ`);
            
            cache.delete('search_' + currentStudentId);
            StorageCache.delete('dashboard_data');
            
            if (currentMode === 'visitor' && currentStudentId) {
                try {
                    const refreshResult = await callAPI(
                        `${SCRIPT_URL}?action=searchStudent&query=${encodeURIComponent(currentStudentId)}`
                    );
                    if (refreshResult.success) {
                        displayStudent(refreshResult.data);
                    }
                } catch (e) { }
            }
            if (currentMode === 'admin') {
                if (adminCurrentDocsStudent) {
                    const freshRes = await callAPI(`${SCRIPT_URL}?action=getStudent&studentId=${encodeURIComponent(currentStudentId)}`);
                    if (freshRes && freshRes.success && freshRes.data) {
                        adminCurrentDocsStudent = freshRes.data;
                        renderAdminDocsList(adminCurrentDocsStudent);
                    }
                }
                cache.delete('all_students');
                await loadStudentsTable();
                await loadStatistics();
            }
        } else {
            showAlert('error', result.message || 'อัปโหลดเอกสารเพิ่มเติมไม่สำเร็จ');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

async function deleteExtraDoc(studentId, docId, docTitle, isFromAdminModal = false) {
    if (!studentId || !docId) return;
    if (!confirm(`คุณต้องการลบเอกสารเพิ่มเติม "${docTitle || 'นี้'}" ใช่หรือไม่?`)) return;

    try {
        showLoading(true);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: {
                action: 'deleteExtraDocument',
                studentId: studentId,
                docId: docId
            }
        });

        if (result && result.success) {
            showAlert('success', `✅ ลบเอกสาร "${docTitle || ''}" เรียบร้อยแล้ว`);
            cache.delete('search_' + studentId);
            StorageCache.delete('dashboard_data');

            if (isFromAdminModal && adminCurrentDocsStudent) {
                const freshRes = await callAPI(`${SCRIPT_URL}?action=getStudent&studentId=${encodeURIComponent(studentId)}`);
                if (freshRes && freshRes.success && freshRes.data) {
                    adminCurrentDocsStudent = freshRes.data;
                    renderAdminDocsList(adminCurrentDocsStudent);
                }
                loadDashboardData(true, true).catch(() => {});
            } else if (currentStudentId === studentId && currentMode === 'visitor') {
                await searchStudent();
            }
        } else {
            showAlert('error', result?.message || 'ลบเอกสารไม่สำเร็จ');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

async function viewExtraDoc(fileName, docTitle = '') {
    if (!fileName) return showAlert('error', 'ไม่พบชื่อไฟล์เอกสาร');
    try {
        showLoading(true);
        let url = `${SCRIPT_URL}?action=getDocument&studentId=${currentStudentId || ''}&documentType=extra&fileName=${encodeURIComponent(fileName)}`;
        const result = await callAPI(url);
        if (result && result.success && result.data) {
            const previewUrl = result.data.previewUrl || result.data.fileUrl;
            const downloadUrl = result.data.directDownloadUrl || result.data.fileUrl;
            document.getElementById('documentViewer').src = previewUrl;
            document.getElementById('documentViewer').style.display = 'block';
            document.getElementById('documentNotFound').style.display = 'none';
            document.getElementById('downloadDocumentLink').href = downloadUrl;
            document.getElementById('deleteDocumentBtn').style.display = 'none';
            document.getElementById('documentViewModal').classList.add('active');
        } else {
            showAlert('info', 'กำลังเปิดดูเอกสาร...');
            window.open(`https://drive.google.com/open?id=${fileName}`, '_blank');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาดในการเปิดดูเอกสาร: ' + err.message);
    } finally {
        showLoading(false);
    }
}

// ============================================================
//  VIEW DOCUMENT
// ============================================================
async function viewDocument(docType, guardian = '') {
    if (!currentStudentId) return showAlert('error', 'กรุณาค้นหานักศึกษาก่อน');
    // บันทึก type ไว้ใช้กับ deleteCurrentDocument
    currentDocumentType = docType;
    currentGuardianType = guardian || null;
    try {
        showLoading(true);
        let url = `${SCRIPT_URL}?action=getDocument&studentId=${currentStudentId}&documentType=${docType}`;
        if (guardian) url += `&guardianType=${guardian}`;
        const result = await callAPI(url);
        if (result.success && result.data) {
            // ใช้ previewUrl สำหรับ iframe (download URL ไม่ทำงานใน iframe)
            const previewUrl = result.data.previewUrl || result.data.fileUrl;
            const downloadUrl = result.data.directDownloadUrl || result.data.fileUrl;
            document.getElementById('documentViewer').src = previewUrl;
            document.getElementById('documentViewer').style.display = 'block';
            document.getElementById('documentNotFound').style.display = 'none';
            document.getElementById('downloadDocumentLink').href = downloadUrl;
            document.getElementById('deleteDocumentBtn').style.display = (currentMode === 'admin' && isAdminLoggedIn) ?
                'inline-flex' : 'none';
            document.getElementById('documentViewModal').classList.add('active');
        } else {
            showAlert('error', result.message || 'ไม่พบเอกสาร');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function closeDocumentViewModal() {
    document.getElementById('documentViewModal').classList.remove('active');
    document.getElementById('documentViewer').src = '';
}

async function deleteCurrentDocument() {
    if (!currentStudentId || !currentDocumentType) return;
    if (!confirm('ลบเอกสารนี้ใช่หรือไม่?')) return;
    try {
        showLoading(true);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: {
                action: 'deleteDocument',
                studentId: currentStudentId,
                documentType: currentDocumentType,
                guardianType: currentGuardianType
            }
        });
        if (result && result.success) {
            closeDocumentViewModal();
            showAlert('success', '✅ ลบเอกสารสำเร็จ (ซิงค์เรียลไทม์)');
            cache.delete('search_' + currentStudentId);
            StorageCache.delete('dashboard_data');
            if (currentMode === 'visitor') await searchStudent();
            if (currentMode === 'admin') await loadDashboardData(true);
        } else {
            showAlert('error', result?.message || 'ลบไม่สำเร็จ');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

// ============================================================
//  ADMIN DOCUMENT MANAGEMENT & DELETION MODAL
// ============================================================
let adminCurrentDocsStudent = null;

const ALL_DOC_CONFIGS = [
    { docType: 'studentIdCard', guardian: null, label: 'สำเนาบัตรประชาชนนักศึกษา', icon: 'fa-id-card' },
    { docType: 'studentHouseReg', guardian: null, label: 'สำเนาทะเบียนบ้านนักศึกษา', icon: 'fa-home' },
    { docType: 'studentTranscript', guardian: null, label: 'ใบผลการเรียน (ปพ. / Transcript)', icon: 'fa-graduation-cap' },
    { docType: 'studentNameChange', guardian: null, label: 'ใบสำคัญการเปลี่ยนชื่อ-สกุล', icon: 'fa-file-signature' },
    { docType: 'studentGradCert', guardian: null, label: 'วุฒิการศึกษาเดิม / ประกาศนียบัตร', icon: 'fa-award' },
    { docType: 'studentBirthCert', guardian: null, label: 'สูติบัตร / ใบเกิด', icon: 'fa-baby' },
    { docType: 'guardianIdCard', guardian: 'father', label: 'สำเนาบัตรประชาชนผู้ปกครอง (พ่อ)', icon: 'fa-male' },
    { docType: 'guardianHouseReg', guardian: 'father', label: 'สำเนาทะเบียนบ้านผู้ปกครอง (พ่อ)', icon: 'fa-house-user' },
    { docType: 'guardianIdCard', guardian: 'mother', label: 'สำเนาบัตรประชาชนผู้ปกครอง (แม่)', icon: 'fa-female' },
    { docType: 'guardianHouseReg', guardian: 'mother', label: 'สำเนาทะเบียนบ้านผู้ปกครอง (แม่)', icon: 'fa-house-user' },
    { docType: 'guardianIdCard', guardian: 'other', label: 'สำเนาบัตรประชาชนผู้ปกครองอื่น', icon: 'fa-user-tie' },
    { docType: 'guardianHouseReg', guardian: 'other', label: 'สำเนาทะเบียนบ้านผู้ปกครองอื่น', icon: 'fa-house-user' }
];

async function openAdminDocsModal(studentId) {
    if (!studentId) return;
    try {
        showLoading(true);
        currentStudentId = studentId;
        
        let student = allStudents.find(s => s.id === studentId);
        const result = await callAPI(`${SCRIPT_URL}?action=getStudent&studentId=${encodeURIComponent(studentId)}`);
        if (result && result.success && result.data) {
            student = result.data;
        }

        if (!student) {
            showAlert('error', 'ไม่พบข้อมูลนักศึกษา: ' + studentId);
            return;
        }

        adminCurrentDocsStudent = student;

        document.getElementById('adminDocsStudentName').textContent = student.name || student.studentName || '-';
        document.getElementById('adminDocsStudentId').textContent = student.id || student.studentId || '-';
        document.getElementById('adminDocsLevel').textContent = student.level || student.educationLevel || '-';
        document.getElementById('adminDocsMajor').textContent = student.major || '-';
        document.getElementById('adminDocsClass').textContent = student.class || '-';
        document.getElementById('adminDocsShift').textContent = student.shift || '-';

        renderAdminDocsList(student);
        document.getElementById('adminDocsModal').classList.add('active');
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function closeAdminDocsModal() {
    const modal = document.getElementById('adminDocsModal');
    if (modal) modal.classList.remove('active');
    adminCurrentDocsStudent = null;
}

function renderAdminDocsList(student) {
    const listContainer = document.getElementById('adminDocsList');
    if (!listContainer) return;

    const docs = student.documents || {};
    const extraDocs = docs.extraDocs || [];
    let uploadedCount = 0;

    let html = ALL_DOC_CONFIGS.map(cfg => {
        let doc = docs[cfg.docType];
        if (cfg.guardian && docs[cfg.docType] && docs[cfg.docType][cfg.guardian]) {
            doc = docs[cfg.docType][cfg.guardian];
        } else if (cfg.guardian) {
            doc = null;
        }

        const uploaded = !!(doc && doc.uploaded);
        if (uploaded) uploadedCount++;
        const fileName = doc?.fileName || '';

        return `
            <div class="admin-doc-item ${uploaded ? 'is-uploaded' : 'is-missing'}">
                <div class="admin-doc-info">
                    <div class="admin-doc-icon"><i class="fas ${cfg.icon}"></i></div>
                    <div class="admin-doc-text">
                        <div class="admin-doc-title">${cfg.label}</div>
                        <div class="admin-doc-filename">
                            ${uploaded 
                                ? `<span style="color:var(--success); font-weight:600;"><i class="fas fa-check-circle"></i> อัปโหลดแล้ว</span> ${fileName ? `• ${fileName}` : ''}` 
                                : `<span style="color:var(--text-muted);"><i class="fas fa-circle"></i> ยังไม่ได้อัปโหลด</span>`
                            }
                        </div>
                    </div>
                </div>
                <div class="admin-doc-actions">
                    ${uploaded ? `
                        <button type="button" class="btn btn-info btn-xs" onclick="viewDocument('${cfg.docType}','${cfg.guardian || ''}')" title="ดูเอกสาร">
                            <i class="fas fa-eye"></i> ดู
                        </button>
                        <button type="button" class="btn btn-danger btn-xs" onclick="deleteDocumentFromAdminModal('${cfg.docType}','${cfg.guardian || ''}')" title="ลบเอกสารนี้">
                            <i class="fas fa-trash"></i> ลบ
                        </button>
                    ` : `
                        <button type="button" class="btn btn-success btn-xs" onclick="openUploadModal('${cfg.docType}','${cfg.guardian || ''}')" title="อัปโหลดเอกสาร">
                            <i class="fas fa-upload"></i> อัปโหลด
                        </button>
                    `}
                </div>
            </div>
        `;
    }).join('');

    // Render Extra Documents if any
    if (extraDocs && extraDocs.length > 0) {
        html += `
            <div style="margin: 20px 0 10px; font-weight: 700; color: var(--secondary); display:flex; align-items:center; gap:8px;">
                <i class="fas fa-folder-plus text-primary"></i> เอกสารอื่นๆ เพิ่มเติม (${extraDocs.length} ไฟล์)
            </div>
        `;
        html += extraDocs.map(exDoc => {
            return `
                <div class="admin-doc-item is-uploaded" style="border-left-color:var(--info);">
                    <div class="admin-doc-info">
                        <div class="admin-doc-icon" style="background:rgba(14,165,233,0.1); color:var(--info);"><i class="fas fa-file-alt"></i></div>
                        <div class="admin-doc-text">
                            <div class="admin-doc-title">${exDoc.title || 'เอกสารเพิ่มเติม'}</div>
                            <div class="admin-doc-filename" style="color:var(--text-secondary);">
                                <span style="color:var(--info); font-weight:600;"><i class="fas fa-paperclip"></i> แนบเพิ่มเติม</span> • ${exDoc.fileName || ''}
                            </div>
                        </div>
                    </div>
                    <div class="admin-doc-actions">
                        <button type="button" class="btn btn-info btn-xs" onclick="viewExtraDoc('${exDoc.fileName || ''}', '${encodeURIComponent(exDoc.title || '')}')" title="ดูเอกสาร">
                            <i class="fas fa-eye"></i> ดู
                        </button>
                        <button type="button" class="btn btn-danger btn-xs" onclick="deleteExtraDoc('${student.id || student.studentId}','${exDoc.id}','${exDoc.title || ''}', true)" title="ลบเอกสารนี้">
                            <i class="fas fa-trash"></i> ลบ
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    listContainer.innerHTML = html;

    const summaryBadge = document.getElementById('adminDocsSummaryBadge');
    if (summaryBadge) {
        summaryBadge.textContent = `${uploadedCount}/12 เอกสารหลัก` + (extraDocs.length > 0 ? ` (+${extraDocs.length} เอกสารเพิ่มเติม)` : '');
        summaryBadge.className = `status-pill ${uploadedCount === 12 ? 'uploaded' : 'missing'}`;
    }
}

async function deleteDocumentDirect(studentId, docType, guardianType) {
    if (!studentId || !docType) return;
    const docName = getDocTypeName(docType, guardianType);
    if (!confirm(`คุณต้องการลบ "${docName}" ของนักศึกษารหัส ${studentId} ใช่หรือไม่?`)) return;

    try {
        showLoading(true);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: {
                action: 'deleteDocument',
                studentId: studentId,
                documentType: docType,
                guardianType: guardianType || null
            }
        });
        if (result && result.success) {
            showAlert('success', `✅ ลบ ${docName} เรียบร้อยแล้ว`);
            cache.delete('search_' + studentId);
            StorageCache.delete('dashboard_data');
            
            // Re-render visitor view if matching current student
            if (currentStudentId === studentId && currentMode === 'visitor') {
                await searchStudent();
            }
            await loadDashboardData(true, true);
        } else {
            showAlert('error', result?.message || 'ลบเอกสารไม่สำเร็จ');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

async function deleteDocumentFromAdminModal(docType, guardianType) {
    if (!adminCurrentDocsStudent) return;
    const studentId = adminCurrentDocsStudent.id || adminCurrentDocsStudent.studentId;
    const docName = getDocTypeName(docType, guardianType);
    if (!confirm(`คุณต้องการลบ "${docName}" ใช่หรือไม่?`)) return;

    try {
        showLoading(true);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: {
                action: 'deleteDocument',
                studentId: studentId,
                documentType: docType,
                guardianType: guardianType || null
            }
        });
        if (result && result.success) {
            showAlert('success', `✅ ลบ ${docName} เรียบร้อยแล้ว`);
            cache.delete('search_' + studentId);
            StorageCache.delete('dashboard_data');
            
            // Reload updated student data into modal
            const freshRes = await callAPI(`${SCRIPT_URL}?action=getStudent&studentId=${studentId}`);
            if (freshRes && freshRes.success && freshRes.data) {
                adminCurrentDocsStudent = freshRes.data;
                renderAdminDocsList(adminCurrentDocsStudent);
            }
            
            loadDashboardData(true, true).catch(() => {});
        } else {
            showAlert('error', result?.message || 'ลบเอกสารไม่สำเร็จ');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

async function adminDeleteAllDocs() {
    if (!adminCurrentDocsStudent) return;
    const studentId = adminCurrentDocsStudent.id || adminCurrentDocsStudent.studentId;
    const studentName = adminCurrentDocsStudent.name || adminCurrentDocsStudent.studentName || '';
    if (!confirm(`⚠️ ยืนยันการลบเอกสารทั้งหมด (ทั้ง 8 รายการ) ของ "${studentName}" (รหัส: ${studentId}) ใช่หรือไม่?\n\nการกระทำนี้จะลบไฟล์ออกจาก Google Drive ด้วย`)) return;

    try {
        showLoading(true);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: {
                action: 'deleteAllStudentDocuments',
                studentId: studentId
            }
        });
        if (result && result.success) {
            showAlert('success', `✅ ลบเอกสารทั้งหมดของรหัส ${studentId} เรียบร้อยแล้ว`);
            cache.delete('search_' + studentId);
            StorageCache.delete('dashboard_data');
            
            // Reload updated student data into modal
            const freshRes = await callAPI(`${SCRIPT_URL}?action=getStudent&studentId=${studentId}`);
            if (freshRes && freshRes.success && freshRes.data) {
                adminCurrentDocsStudent = freshRes.data;
                renderAdminDocsList(adminCurrentDocsStudent);
            }
            
            loadDashboardData(true, true).catch(() => {});
        } else {
            showAlert('error', result?.message || 'ลบเอกสารไม่สำเร็จ');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

// ============================================================
//  ADMIN LOGIN
// ============================================================
async function adminLogin() {
    const user = document.getElementById('adminUsername').value.trim();
    const pass = document.getElementById('adminPassword').value.trim();
    if (!user || !pass) return showAlert('error', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
    try {
        showLoading(true);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action: 'adminLogin', username: user, password: pass }
        });
        if (result.success) {
            isAdminLoggedIn = true;
            localStorage.setItem('adminLoggedIn', 'true');
            localStorage.setItem('adminToken', result.data.token);
            document.getElementById('adminLoginForm').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'block';
            showAlert('success', 'เข้าสู่ระบบสำเร็จ');
            await loadDashboardData(true);
        } else {
            showAlert('error', result.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function adminLogout() {
    if (!confirm('ออกจากระบบ?')) return;
    isAdminLoggedIn = false;
    localStorage.removeItem('adminLoggedIn');
    localStorage.removeItem('adminToken');
    document.getElementById('adminLoginForm').style.display = 'block';
    document.getElementById('adminPanel').style.display = 'none';
    document.getElementById('reportSection').style.display = 'none';
    showAlert('success', 'ออกจากระบบแล้ว');
}

// ============================================================
//  SYSTEM HEALTH CHECK & AUTO-REPAIR
// ============================================================

function openHealthCheckModal() {
    document.getElementById('healthCheckModal').classList.add('active');
    runSystemHealthCheck();
}

function closeHealthCheckModal() {
    document.getElementById('healthCheckModal').classList.remove('active');
}

async function runSystemHealthCheck() {
    const scoreCircle = document.getElementById('healthMeterCircle');
    const scoreVal = document.getElementById('healthScoreVal');
    const scoreLbl = document.getElementById('healthScoreLbl');
    const title = document.getElementById('healthStatusTitle');
    const desc = document.getElementById('healthSummaryDesc');
    
    scoreVal.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:1rem;"></i>';
    scoreLbl.textContent = 'กำลังสแกน';
    title.textContent = 'สถานะระบบ: กำลังสแกนวิเคราะห์...';
    desc.textContent = 'กำลังตรวจสอบการเชื่อมต่อ Google Sheets, สิทธิ์ Google Drive, ความสมบูรณ์ของเอกสาร และตรวจจับไฟล์ขยะ';

    try {
        const result = await callAPI(`${SCRIPT_URL}?action=performHealthCheck`);
        if (result && result.success && result.data) {
            const data = result.data;
            const score = data.healthScore !== undefined ? data.healthScore : 100;
            scoreVal.textContent = score + '%';
            
            scoreCircle.className = 'health-meter-circle';
            if (score >= 90) {
                scoreLbl.textContent = 'ยอดเยี่ยม';
                title.textContent = 'สถานะระบบ: ยอดเยี่ยม (EXCELLENT)';
                desc.textContent = 'ระบบทำงานปกติ ฐานข้อมูลและไฟล์เชื่อมต่อสมบูรณ์ พร้อมใช้งาน 100%';
            } else if (score >= 70) {
                scoreCircle.classList.add('warning');
                scoreLbl.textContent = 'ดี';
                title.textContent = 'สถานะระบบ: ดี (GOOD)';
                desc.textContent = 'ระบบสามารถทำงานได้ แต่พบคำแนะนำหรือไฟล์ที่ควรได้รับการดูแล';
            } else {
                scoreCircle.classList.add('critical');
                scoreLbl.textContent = 'ควรปรับปรุง';
                title.textContent = 'สถานะระบบ: พบปัญหา (ATTENTION NEEDED)';
                desc.textContent = 'พบข้อผิดพลาดหรือลิงก์ไฟล์สูญหาย กรุณากดปุ่มซ่อมแซมระบบด้านล่าง';
            }

            // Sheet card
            document.getElementById('diagSheetName').textContent = data.spreadsheet.name || '-';
            document.getElementById('diagStudentCount').textContent = (data.spreadsheet.totalStudents || 0) + ' คน';
            document.getElementById('diagColumnsStatus').innerHTML = data.spreadsheet.columnsValid 
                ? '<span style="color:var(--success);"><i class="fas fa-check-circle"></i> ครบถ้วน</span>' 
                : '<span style="color:var(--danger);"><i class="fas fa-times-circle"></i> ไม่ครบ</span>';
            const sheetBadge = document.getElementById('diagSheetBadge');
            sheetBadge.textContent = data.spreadsheet.connected ? 'เชื่อมต่อแล้ว' : 'ไม่พบ';
            sheetBadge.className = data.spreadsheet.connected ? 'badge badge-success' : 'badge badge-danger';

            // Drive card
            document.getElementById('diagFolderName').textContent = data.drive.name || '-';
            document.getElementById('diagTotalDriveFiles').textContent = (data.drive.totalFilesInFolder || 0) + ' ไฟล์';
            document.getElementById('diagSharingStatus').innerHTML = data.drive.isPublic 
                ? '<span style="color:var(--success);"><i class="fas fa-lock-open"></i> สาธารณะ (ถูกต้อง)</span>' 
                : '<span style="color:var(--warning);"><i class="fas fa-lock"></i> ยังไม่เปิดสาธารณะ</span>';
            const driveBadge = document.getElementById('diagDriveBadge');
            driveBadge.textContent = data.drive.connected ? 'เชื่อมต่อแล้ว' : 'ไม่พบ';
            driveBadge.className = data.drive.connected ? 'badge badge-success' : 'badge badge-danger';

            // Document card
            document.getElementById('diagTotalExpectedDocs').textContent = (data.documents.totalRecords || 0) + ' รายการ';
            document.getElementById('diagFoundDriveFiles').textContent = (data.documents.existingFilesInDrive || 0) + ' ไฟล์';
            const brokenCount = (data.documents.brokenLinks || []).length;
            const brokenEl = document.getElementById('diagBrokenLinksCount');
            brokenEl.textContent = brokenCount + ' ไฟล์';
            brokenEl.style.color = brokenCount === 0 ? 'var(--success)' : 'var(--danger)';
            const docBadge = document.getElementById('diagDocBadge');
            docBadge.textContent = brokenCount === 0 ? 'สมบูรณ์ 100%' : `มีปัญหา ${brokenCount}`;
            docBadge.className = brokenCount === 0 ? 'badge badge-success' : 'badge badge-warning';

            // Orphan cleaner card
            const orphanCount = (data.documents.orphanFiles || []).length;
            document.getElementById('diagOrphansCount').textContent = orphanCount + ' ไฟล์';
            document.getElementById('diagStorageStatus').textContent = orphanCount > 0 ? 'มีไฟล์ตกค้าง' : 'สะอาด เรียบร้อย';
            document.getElementById('diagOrphanAdvice').textContent = orphanCount > 0 ? 'กด "ล้างไฟล์ขยะ" ได้' : 'ไม่มีไฟล์ขยะ';
            const orphanBadge = document.getElementById('diagOrphanBadge');
            orphanBadge.textContent = orphanCount === 0 ? 'สะอาด' : `พบ ${orphanCount} ไฟล์`;
            orphanBadge.className = orphanCount === 0 ? 'badge badge-success' : 'badge badge-info';

            // Issues section
            const issuesSection = document.getElementById('healthIssuesSection');
            const issuesList = document.getElementById('healthIssuesList');
            if (data.issues && data.issues.length > 0) {
                issuesList.innerHTML = data.issues.map(iss => `
                    <div class="issue-item">
                        <i class="fas ${iss.type === 'ERROR' ? 'fa-times-circle' : 'fa-exclamation-triangle'}" style="color:${iss.type === 'ERROR' ? 'var(--danger)' : 'var(--warning)'}; margin-top:2px;"></i>
                        <div>
                            <strong style="color:var(--secondary);">${iss.title}</strong>
                            <div style="color:var(--text-muted); font-size:0.8rem; margin-top:1px;">${iss.detail}</div>
                        </div>
                    </div>
                `).join('');
                issuesSection.style.display = 'block';
            } else {
                issuesSection.style.display = 'none';
            }
        } else {
            showAlert('error', 'ไม่สามารถตรวจสุขภาพระบบได้: ' + (result?.message || ''));
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาดในการตรวจสุขภาพระบบ: ' + err.message);
    }
}

async function executeSystemRepair(repairType = 'all') {
    const titles = {
        all: 'ซ่อมแซมระบบทั้งหมด (สิทธิ์แชร์ไฟล์, ล้างไฟล์ขยะ, ปรับโครงสร้าง Sheet)',
        orphans: 'ล้างไฟล์ขยะที่ไม่มีเจ้าของใน Google Drive',
        permissions: 'เปิดสิทธิ์แชร์โฟลเดอร์และไฟล์ทั้งหมดใน Google Drive เป็นสาธารณะ'
    };
    if (!confirm(`ยืนยันการดำเนินการ: ${titles[repairType] || repairType} ใช่หรือไม่?`)) return;

    try {
        showLoading(true);
        showAlert('info', 'กำลังดำเนินการซ่อมแซมระบบ...');
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action: 'repairSystemIssues', repairType: repairType }
        });
        if (result && result.success) {
            showAlert('success', '✅ ' + (result.message || 'ซ่อมแซมระบบเรียบร้อยแล้ว'));
            StorageCache.clear();
            await runSystemHealthCheck();
        } else {
            showAlert('error', '❌ ซ่อมแซมไม่สำเร็จ: ' + (result?.message || ''));
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

// ============================================================
//  AUDIT TRAIL / ACTIVITY LOGS
// ============================================================

let allAuditLogs = [];

function openAuditLogsModal() {
    document.getElementById('auditLogsModal').classList.add('active');
    loadAuditLogs();
}

function closeAuditLogsModal() {
    document.getElementById('auditLogsModal').classList.remove('active');
}

async function loadAuditLogs() {
    const tbody = document.getElementById('auditLogsTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> กำลังโหลดประวัติกิจกรรม...</td></tr>';
    
    try {
        const result = await callAPI(`${SCRIPT_URL}?action=getActivityLogs&limit=200`);
        if (result && result.success) {
            allAuditLogs = result.data || [];
            renderAuditLogsTable(allAuditLogs);
        } else {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--danger);">${result?.message || 'ไม่สามารถโหลดประวัติกิจกรรมได้'}</td></tr>`;
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--danger);">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
    }
}

function renderAuditLogsTable(logs) {
    const tbody = document.getElementById('auditLogsTableBody');
    if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">ยังไม่มีประวัติกิจกรรมในระบบ</td></tr>';
        return;
    }

    const actionBadgeClasses = {
        ADD_STUDENT: 'add',
        UPDATE_STUDENT: 'add',
        DELETE_STUDENT: 'delete',
        BULK_DELETE: 'delete',
        UPLOAD_DOCUMENT: 'upload',
        DELETE_DOCUMENT: 'delete',
        CLEAR_ALL_DOCS: 'delete',
        ADMIN_LOGIN: 'auth',
        LOGIN_FAILED: 'auth',
        CHANGE_PASSWORD: 'auth',
        SYSTEM_REPAIR: 'upload',
        CONFIG_CHANGE: 'upload'
    };

    tbody.innerHTML = logs.map(log => {
        const actionClass = actionBadgeClasses[log.action] || 'upload';
        const isSuccess = (log.status || 'SUCCESS').toUpperCase() === 'SUCCESS';
        let formattedTime = log.timestamp;
        try {
            const d = new Date(log.timestamp);
            formattedTime = d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' });
        } catch(e) {}

        return `
            <tr>
                <td style="font-size:0.8rem; color:var(--text-secondary);">${formattedTime}</td>
                <td><span class="badge-action ${actionClass}">${log.action}</span></td>
                <td>${log.details || '-'}</td>
                <td><strong>${log.user || 'system'}</strong></td>
                <td>
                    <span class="${isSuccess ? 'badge-status-success' : 'badge-status-failed'}">
                        <i class="fas ${isSuccess ? 'fa-check' : 'fa-times'}"></i> ${log.status || 'SUCCESS'}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

function filterAuditLogs() {
    const search = document.getElementById('logSearchInput').value.toLowerCase().trim();
    const actionFilter = document.getElementById('logActionFilter').value;

    const filtered = allAuditLogs.filter(log => {
        const matchSearch = !search || 
            (log.action && log.action.toLowerCase().includes(search)) ||
            (log.details && log.details.toLowerCase().includes(search)) ||
            (log.user && log.user.toLowerCase().includes(search));
        const matchAction = !actionFilter || log.action === actionFilter;
        return matchSearch && matchAction;
    });

    renderAuditLogsTable(filtered);
}

async function clearAllAuditLogs() {
    if (!confirm('ยืนยันการล้างประวัติกิจกรรมทั้งหมดในระบบใช่หรือไม่?')) return;
    try {
        showLoading(true);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action: 'clearActivityLogs' }
        });
        if (result && result.success) {
            showAlert('success', '✅ ล้างประวัติกิจกรรมเรียบร้อยแล้ว');
            await loadAuditLogs();
        } else {
            showAlert('error', result?.message || 'ล้างประวัติไม่สำเร็จ');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function exportLogsToJSON() {
    if (!allAuditLogs || allAuditLogs.length === 0) return showAlert('error', 'ไม่มีข้อมูลประวัติกิจกรรม');
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(allAuditLogs, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', `activity_logs_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    showAlert('success', 'ส่งออกไฟล์ Logs สำเร็จ');
}

// ============================================================
//  CHANGE ADMIN PASSWORD
// ============================================================

function openChangePasswordModal() {
    document.getElementById('oldPasswordInput').value = '';
    document.getElementById('newPasswordInput').value = '';
    document.getElementById('confirmNewPasswordInput').value = '';
    document.getElementById('changePasswordModal').classList.add('active');
}

function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').classList.remove('active');
}

async function saveNewAdminPassword() {
    const oldPass = document.getElementById('oldPasswordInput').value.trim();
    const newPass = document.getElementById('newPasswordInput').value.trim();
    const confirmPass = document.getElementById('confirmNewPasswordInput').value.trim();

    if (!oldPass || !newPass || !confirmPass) {
        return showAlert('error', 'กรุณากรอกข้อมูลให้ครบทุกช่อง');
    }
    if (newPass.length < 4) {
        return showAlert('error', 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร');
    }
    if (newPass !== confirmPass) {
        return showAlert('error', 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน');
    }

    try {
        showLoading(true);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: {
                action: 'changeAdminPassword',
                oldPassword: oldPass,
                newPassword: newPass
            }
        });
        if (result && result.success) {
            showAlert('success', '🔒 ' + (result.message || 'เปลี่ยนรหัสผ่านแอดมินเรียบร้อยแล้ว'));
            closeChangePasswordModal();
        } else {
            showAlert('error', '❌ ' + (result?.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ'));
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

// ============================================================
//  1-CLICK DATABASE BACKUP & RESTORE
// ============================================================

let currentBackupsList = [];

function openBackupModal() {
    document.getElementById('backupRestoreModal').classList.add('active');
    loadBackupSnapshots();
}

function closeBackupModal() {
    document.getElementById('backupRestoreModal').classList.remove('active');
}

async function loadBackupSnapshots() {
    const tbody = document.getElementById('backupListTableBody');
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:25px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> กำลังโหลดรายการจุดสำรองข้อมูล...</td></tr>';

    try {
        const result = await callAPI(`${SCRIPT_URL}?action=listBackupSnapshots`);
        if (result && result.success) {
            currentBackupsList = result.data || [];
            renderBackupListTable(currentBackupsList);
        } else {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--danger);">${result?.message || 'ไม่สามารถโหลดรายการสำรองได้'}</td></tr>`;
        }
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--danger);">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
    }
}

function renderBackupListTable(backups) {
    const tbody = document.getElementById('backupListTableBody');
    if (!backups || backups.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:25px; color:var(--text-muted);">ยังไม่มีจุดสำรองข้อมูลใน Google Sheets</td></tr>';
        return;
    }

    tbody.innerHTML = backups.map(b => {
        return `
            <tr>
                <td><strong><i class="fas fa-table" style="color:var(--primary); margin-right:6px;"></i> ${b.sheetName}</strong></td>
                <td><span class="status-pill uploaded" style="font-size:0.8rem;">${b.totalStudents} คน</span></td>
                <td>
                    <div style="display:flex; gap:6px;">
                        <button type="button" class="btn btn-warning btn-xs" onclick="restoreSnapshot('${b.sheetName}')" title="กู้คืนข้อมูล">
                            <i class="fas fa-undo"></i> กู้คืน
                        </button>
                        <button type="button" class="btn btn-danger btn-xs" onclick="deleteSnapshot('${b.sheetName}')" title="ลบแท็บสำรองนี้">
                            <i class="fas fa-trash"></i> ลบ
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function createSnapshotNow() {
    try {
        showLoading(true);
        showAlert('info', 'กำลังสร้างจุดสำรองข้อมูล Snapshot ใน Google Sheets...');
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action: 'createBackupSnapshot' }
        });
        if (result && result.success) {
            showAlert('success', '💾 ' + (result.message || 'สร้างจุดสำรองข้อมูลสำเร็จ'));
            await loadBackupSnapshots();
        } else {
            showAlert('error', '❌ ' + (result?.message || 'สร้างจุดสำรองข้อมูลไม่สำเร็จ'));
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

async function restoreSnapshot(sheetName) {
    if (!confirm(`⚠️ ยืนยันการกู้คืนข้อมูลจาก Snapshot "${sheetName}" ใช่หรือไม่?\n\nข้อมูลนักศึกษาปัจจุบันจะถูกแทนที่ด้วยข้อมูลจากแท็บนี้`)) return;

    try {
        showLoading(true);
        showAlert('info', 'กำลังกู้คืนข้อมูล...');
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action: 'restoreBackupSnapshot', sheetName: sheetName }
        });
        if (result && result.success) {
            showAlert('success', '✅ ' + (result.message || 'กู้คืนข้อมูลเรียบร้อยแล้ว'));
            StorageCache.clear();
            closeBackupModal();
            await loadDashboardData(true);
        } else {
            showAlert('error', '❌ ' + (result?.message || 'กู้คืนข้อมูลไม่สำเร็จ'));
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

async function deleteSnapshot(sheetName) {
    if (!confirm(`ต้องการลบแท็บสำรองข้อมูล "${sheetName}" ใช่หรือไม่?`)) return;

    try {
        showLoading(true);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action: 'deleteBackupSnapshot', sheetName: sheetName }
        });
        if (result && result.success) {
            showAlert('success', '🗑️ ' + (result.message || 'ลบแท็บสำรองเรียบร้อยแล้ว'));
            await loadBackupSnapshots();
        } else {
            showAlert('error', '❌ ' + (result?.message || 'ลบไม่สำเร็จ'));
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function downloadFullJsonBackup() {
    if (!allStudents || allStudents.length === 0) return showAlert('error', 'ไม่มีข้อมูลนักศึกษาสำหรับสำรอง');
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(allStudents, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', `students_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    showAlert('success', 'ดาวน์โหลดไฟล์สำรอง JSON เรียบร้อยแล้ว');
}

async function handleRestoreJsonFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const json = JSON.parse(text);
        const students = Array.isArray(json) ? json : (json.data || json.students || []);
        if (!students || students.length === 0) {
            return showAlert('error', 'ไม่พบข้อมูลนักศึกษาในไฟล์ JSON ที่ถูกต้อง');
        }

        if (!confirm(`พบข้อมูลนักศึกษา ${students.length} รายการในไฟล์ ต้องการนำเข้าและกู้คืนใช่หรือไม่?`)) return;

        showLoading(true);
        showAlert('info', `กำลังกู้คืนข้อมูล ${students.length} รายการ...`);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action: 'importStudentsFromExcel', students: students }
        });
        if (result && result.success) {
            showAlert('success', '✅ ' + (result.message || 'กู้คืนข้อมูลจากไฟล์ JSON สำเร็จ'));
            StorageCache.clear();
            closeBackupModal();
            await loadDashboardData(true);
        } else {
            showAlert('error', '❌ ' + (result?.message || 'กู้คืนข้อมูลไม่สำเร็จ'));
        }
    } catch (err) {
        showAlert('error', 'ไฟล์ JSON ไม่ถูกต้องหรือเกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
        e.target.value = '';
    }
}

// ============================================================
//  STUDENT DIRECT LINK & QR CODE GENERATOR
// ============================================================

let currentQrStudent = null;

function getStudentDirectUrl(studentId) {
    const base = window.location.origin + window.location.pathname;
    return `${base}?studentId=${encodeURIComponent(studentId)}`;
}

function copyStudentDirectLink(studentId) {
    const sid = studentId || currentStudentId;
    if (!sid) return showAlert('error', 'กรุณาระบุรหัสนักศึกษา');
    const url = getStudentDirectUrl(sid);
    navigator.clipboard.writeText(url).then(() => {
        showAlert('success', `📋 คัดลอกลิงก์ตรงของรหัส ${sid} เรียบร้อยแล้ว`);
    }).catch(() => {
        prompt('คัดลอกลิงก์ตรง:', url);
    });
}

async function openStudentQrModal(studentId) {
    const sid = studentId || currentStudentId;
    if (!sid) return showAlert('error', 'กรุณาระบุรหัสนักศึกษา');

    let student = allStudents.find(s => s.id === sid);
    if (!student) {
        try {
            showLoading(true);
            const res = await callAPI(`${SCRIPT_URL}?action=getStudent&studentId=${encodeURIComponent(sid)}`);
            if (res && res.success && res.data) student = res.data;
        } catch(e) {} finally {
            showLoading(false);
        }
    }

    currentQrStudent = student || { id: sid, name: 'นักศึกษา', major: '-', level: '-' };

    document.getElementById('qrStudentName').textContent = currentQrStudent.name || currentQrStudent.studentName || 'นักศึกษา';
    document.getElementById('qrStudentId').textContent = currentQrStudent.id || currentQrStudent.studentId || sid;
    document.getElementById('qrStudentMajor').textContent = currentQrStudent.major || '-';
    document.getElementById('qrStudentLevel').textContent = currentQrStudent.level || currentQrStudent.educationLevel || '-';

    const directUrl = getStudentDirectUrl(sid);
    document.getElementById('qrDirectLinkInput').value = directUrl;

    // Generate high-resolution QR Code
    const qrImg = document.getElementById('qrImageElement');
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(directUrl)}&margin=10`;

    document.getElementById('qrCodeModal').classList.add('active');
}

function closeQrCodeModal() {
    document.getElementById('qrCodeModal').classList.remove('active');
}

async function downloadQrPng() {
    if (!currentQrStudent) return;
    const sid = currentQrStudent.id || currentQrStudent.studentId;
    const directUrl = getStudentDirectUrl(sid);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(directUrl)}&margin=15`;
    
    try {
        showAlert('info', 'กำลังดาวน์โหลดรูปภาพ QR Code...');
        const res = await fetch(qrUrl);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `QRCode_${sid}_${currentQrStudent.name || ''}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
        showAlert('success', 'ดาวน์โหลด QR Code สำเร็จ');
    } catch(e) {
        window.open(qrUrl, '_blank');
    }
}

function printQrCard() {
    if (!currentQrStudent) return;
    const sid = currentQrStudent.id || currentQrStudent.studentId;
    const name = currentQrStudent.name || currentQrStudent.studentName || '';
    const major = currentQrStudent.major || '-';
    const level = currentQrStudent.level || currentQrStudent.educationLevel || '-';
    const directUrl = getStudentDirectUrl(sid);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(directUrl)}&margin=10`;

    const printWin = window.open('', '_blank');
    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>QR Code นักศึกษา - ${sid}</title>
            <meta charset="utf-8" />
            <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Noto Sans Thai', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f1f5f9; }
                .card { background: #fff; border: 2px solid #6366f1; border-radius: 16px; padding: 28px; width: 340px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
                h2 { margin: 0 0 4px 0; color: #1e293b; font-size: 1.3rem; }
                p { margin: 4px 0; color: #64748b; font-size: 0.9rem; }
                .qr-img { width: 220px; height: 220px; margin: 16px auto; display: block; border-radius: 8px; border: 1px solid #e2e8f0; }
                .footer { font-size: 0.78rem; color: #94a3b8; margin-top: 14px; }
                @media print {
                    body { background: #fff; }
                    .card { box-shadow: none; border: 2px solid #000; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>${name}</h2>
                <p><strong>รหัสนักศึกษา: ${sid}</strong></p>
                <p>${level} | สาขา: ${major}</p>
                <img class="qr-img" src="${qrUrl}" alt="QR Code" />
                <p style="font-weight:600; color:#4f46e5; font-size:0.85rem;">สแกนเพื่อเปิดหน้าระบบเอกสาร</p>
                <div class="footer">ระบบจัดการเอกสารนักศึกษาและผู้ปกครอง</div>
                <div class="no-print" style="margin-top:20px;">
                    <button onclick="window.print()" style="padding:8px 18px; background:#4f46e5; color:#fff; border:none; border-radius:6px; cursor:pointer; font-family:'Noto Sans Thai';">🖨️ พิมพ์บัตร</button>
                    <button onclick="window.close()" style="padding:8px 14px; background:#94a3b8; color:#fff; border:none; border-radius:6px; cursor:pointer; font-family:'Noto Sans Thai'; margin-left:6px;">ปิด</button>
                </div>
            </div>
        </body>
        </html>
    `);
    printWin.document.close();
}

// ============================================================
//  ADMIN TABLE
// ============================================================
async function loadStudentsTable(page = 1, search = '') {
    if (search || page !== 1) {
        applyFiltersAndRender(page, search);
        return;
    }
    await loadDashboardData(false);
}

function applyFiltersAndRender(page = 1, search = '') {
    const level = document.getElementById('filterLevel').value;
    const major = document.getElementById('filterMajor').value;
    const shift = document.getElementById('filterShift').value;
    const docStatus = document.getElementById('filterDocStatus').value;

    filteredStudents = allStudents.filter(s => {
        if (level && s.level !== level) return false;
        if (major && s.major !== major) return false;
        if (shift && s.shift !== shift) return false;
        if (docStatus) {
            const uploaded = parseInt((s.docs || '0/8').split('/')[0]);
            if (docStatus === 'complete' && uploaded < 8) return false;
            if (docStatus === 'incomplete' && uploaded === 8) return false;
        }
        if (search) {
            const q = search.toLowerCase();
            if (!s.id.toString().toLowerCase().includes(q) &&
                !s.name.toLowerCase().includes(q)) return false;
        }
        return true;
    });

    currentPage = page;
    const start = (page - 1) * pageSize;
    const paged = filteredStudents.slice(start, start + pageSize);
    renderTable(paged);
    updateTableCount(filteredStudents.length);
    renderPagination();
}

function renderTable(students) {
    const tbody = document.getElementById('studentsTableBody');
    if (!students || students.length === 0) {
        tbody.innerHTML =
            `<tr><td colspan="9" style="text-align:center; padding:40px; color:var(--text-muted);">ไม่พบข้อมูล</td></tr>`;
        return;
    }
    let html = '';
    students.forEach(s => {
        const uploaded = parseInt((s.docs || '0/8').split('/')[0]);
        const complete = uploaded === 8;
        html += `
            <tr>
                <td><input type="checkbox" class="student-checkbox" value="${s.id}" /></td>
                <td><strong>${s.id}</strong></td>
                <td>${s.name}</td>
                <td>${s.level}</td>
                <td>${s.major}</td>
                <td>${s.class || '-'}</td>
                <td>${s.shift || '-'}</td>
                <td><span class="status-pill ${complete ? 'uploaded' : 'missing'}" style="border-radius:20px;">${s.docs || '0/8'}</span></td>
                <td>
                    <div class="action-cell">
                        <button class="action-btn view-details" data-id="${s.id}" title="ดูข้อมูล"><i class="fas fa-eye"></i></button>
                        <button class="action-btn show-qr" data-id="${s.id}" title="QR Code ประจำตัว"><i class="fas fa-qrcode"></i></button>
                        <button class="action-btn manage-docs" data-id="${s.id}" title="จัดการและลบเอกสาร"><i class="fas fa-folder-open"></i></button>
                        <button class="action-btn edit-student" data-id="${s.id}" title="แก้ไขนักศึกษา"><i class="fas fa-edit"></i></button>
                        <button class="action-btn danger delete-student" data-id="${s.id}" title="ลบนักศึกษา"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
    updateSelectedCount();
}

function updateTableCount(count) {
    document.getElementById('tableCount').textContent = `พบทั้งหมด ${count} รายการ`;
}

function renderPagination() {
    const container = document.querySelector('.pagination-container');
    const total = Math.ceil(filteredStudents.length / pageSize);
    if (total <= 1) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    const search = document.getElementById('adminSearchInput').value;
    let html = `
        <div style="display:flex; gap:12px; align-items:center; justify-content:center; flex-wrap:wrap; margin-top:12px;">
            <button class="btn btn-outline btn-sm" ${currentPage <= 1 ? 'disabled' : ''} onclick="loadStudentsTable(${currentPage - 1},'${search}')">
                <i class="fas fa-chevron-left"></i> ก่อนหน้า
            </button>
            <span style="font-weight:600;">หน้า ${currentPage} จาก ${total}</span>
            <button class="btn btn-outline btn-sm" ${currentPage >= total ? 'disabled' : ''} onclick="loadStudentsTable(${currentPage + 1},'${search}')">
                ถัดไป <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `;
    container.innerHTML = html;
}

// ============================================================
//  STATISTICS
// ============================================================
async function loadStatistics() {
    try {
        const result = await callAPI(`${SCRIPT_URL}?action=getStatistics`);
        if (result && result.success) {
            renderStats(result.data);
            renderClassDist(result.data);
            return;
        }
    } catch (e) {}
    // fallback client-side
    const stats = {
        totalStudents: allStudents.length,
        levels: {},
        shifts: { เช้า: 0, บ่าย: 0 },
        majors: {},
        studentsWithCompleteDocs: 0
    };
    allStudents.forEach(s => {
        stats.levels[s.level] = (stats.levels[s.level] || 0) + 1;
        stats.shifts[s.shift] = (stats.shifts[s.shift] || 0) + 1;
        stats.majors[s.major] = (stats.majors[s.major] || 0) + 1;
        const uploaded = parseInt((s.docs || '0/8').split('/')[0]);
        if (uploaded === 8) stats.studentsWithCompleteDocs++;
    });
    renderStats(stats);
    renderClassDist(stats);
}

function renderStats(stats) {
    const rate = stats.totalStudents > 0 ? ((stats.studentsWithCompleteDocs / stats.totalStudents) * 100).toFixed(1) : 0;
    document.getElementById('statCards').innerHTML = `
        <div class="stat-card">
            <span class="icon"><i class="fas fa-users"></i></span>
            <div class="number">${stats.totalStudents}</div>
            <div class="label">นักเรียนทั้งหมด</div>
        </div>
        <div class="stat-card">
            <span class="icon"><i class="fas fa-graduation-cap"></i></span>
            <div class="number">${Object.keys(stats.levels).length}</div>
            <div class="label">ระดับการศึกษา</div>
        </div>
        <div class="stat-card">
            <span class="icon"><i class="fas fa-check-circle"></i></span>
            <div class="number">${stats.studentsWithCompleteDocs}</div>
            <div class="label">เอกสารครบถ้วน</div>
        </div>
        <div class="stat-card">
            <span class="icon"><i class="fas fa-chart-line"></i></span>
            <div class="number">${rate}%</div>
            <div class="label">อัตราความครบถ้วน</div>
        </div>
    `;
}

function renderClassDist(stats) {
    const container = document.getElementById('classDistribution');
    const card = document.getElementById('classDistributionCard');
    const entries = Object.entries(stats.levels || {}).sort((a, b) => a[0].localeCompare(b[0]));
    if (entries.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    container.innerHTML = entries.map(([name, count]) => {
        const pct = stats.totalStudents > 0 ? ((count / stats.totalStudents) * 100).toFixed(1) : 0;
        return `
            <div class="class-item">
                <div class="name">${name}</div>
                <div class="count">${count}</div>
                <div class="bar"><div class="fill" style="width:${pct}%;"></div></div>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">${pct}%</div>
            </div>
        `;
    }).join('');
}

// ============================================================
//  REPORT
// ============================================================
async function generateReport() {
    try {
        showLoading(true);
        const result = await callAPI(`${SCRIPT_URL}?action=generateReport`);
        if (result.success) {
            const data = result.data;
            const total = data.totalStudents;
            const idPct = total > 0 ? ((data.documentStats.totalWithIdCard / total) * 100).toFixed(1) : 0;
            const housePct = total > 0 ? ((data.documentStats.totalWithHouseReg / total) * 100).toFixed(1) : 0;
            const compPct = total > 0 ? ((data.documentStats.completeDocuments / total) * 100).toFixed(1) : 0;

            let levelHtml = '',
                majorHtml = '';
            for (const [k, v] of Object.entries(data.byLevel || {})) {
                levelHtml +=
                    `<div class="detail-item"><span>${k}</span><span>${v} คน (${((v/total)*100).toFixed(1)}%)</span></div>`;
            }
            for (const [k, v] of Object.entries(data.byMajor || {})) {
                majorHtml += `<div class="detail-item"><span>${k}</span><span>${v} คน</span></div>`;
            }

            document.getElementById('reportContent').innerHTML = `
                <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; margin-bottom:28px;">
                    <div style="background:linear-gradient(135deg,var(--primary),var(--primary-dark)); color:#fff; padding:24px; border-radius:var(--radius-md); text-align:center;">
                        <h4 style="font-weight:400; opacity:0.8;">นักเรียนทั้งหมด</h4>
                        <div style="font-size:2.4rem; font-weight:800;">${total}</div>
                    </div>
                    <div style="background:linear-gradient(135deg,var(--success),hsl(160,70%,40%)); color:#fff; padding:24px; border-radius:var(--radius-md); text-align:center;">
                        <h4 style="font-weight:400; opacity:0.8;">มีบัตรประชาชน</h4>
                        <div style="font-size:2.4rem; font-weight:800;">${data.documentStats.totalWithIdCard}</div>
                        <div style="opacity:0.8;">${idPct}%</div>
                    </div>
                    <div style="background:linear-gradient(135deg,var(--info),hsl(200,75%,45%)); color:#fff; padding:24px; border-radius:var(--radius-md); text-align:center;">
                        <h4 style="font-weight:400; opacity:0.8;">มีทะเบียนบ้าน</h4>
                        <div style="font-size:2.4rem; font-weight:800;">${data.documentStats.totalWithHouseReg}</div>
                        <div style="opacity:0.8;">${housePct}%</div>
                    </div>
                    <div style="background:linear-gradient(135deg,var(--accent),var(--accent-dark)); color:#fff; padding:24px; border-radius:var(--radius-md); text-align:center;">
                        <h4 style="font-weight:400; opacity:0.8;">เอกสารครบถ้วน</h4>
                        <div style="font-size:2.4rem; font-weight:800;">${data.documentStats.completeDocuments}</div>
                        <div style="opacity:0.8;">${compPct}%</div>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px;">
                    <div style="background:rgba(0,0,0,0.02); padding:20px; border-radius:var(--radius-sm);">
                        <h4 style="margin-bottom:12px;"><i class="fas fa-graduation-cap"></i> จำแนกตามระดับ</h4>
                        ${levelHtml}
                    </div>
                    <div style="background:rgba(0,0,0,0.02); padding:20px; border-radius:var(--radius-sm);">
                        <h4 style="margin-bottom:12px;"><i class="fas fa-book"></i> จำแนกตามสาขา</h4>
                        ${majorHtml}
                    </div>
                </div>
            `;
            document.getElementById('reportSection').style.display = 'block';
            document.getElementById('reportSection').scrollIntoView({ behavior: 'smooth' });
            showAlert('success', 'สร้างรายงานสำเร็จ');
        } else {
            showAlert('error', result.message || 'สร้างรายงานไม่สำเร็จ');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function printReport() {
    const content = document.getElementById('reportContent');
    if (!content) return;
    const win = window.open('', '_blank');
    win.document.write(`
        <html><head>
            <title>รายงานสรุปข้อมูล</title>
            <style>
                body{font-family:'Noto Sans Thai',sans-serif;padding:20px;color:#333;}
                .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:28px;}
                .card{background:#f8fafc;padding:20px;border-radius:12px;text-align:center;border:1px solid #e2e8f0;}
                .number{font-size:2rem;font-weight:800;}
                .detail-item{display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #e2e8f0;}
                .details{display:grid;grid-template-columns:1fr 1fr;gap:24px;}
                @media print{body{margin:0;}}
                @media (max-width:600px){.details{grid-template-columns:1fr;}}
            </style>
        </head>
        <body>
            <h1 style="text-align:center;">รายงานสรุปข้อมูล</h1>
            <p style="text-align:center;color:#666;">${new Date().toLocaleDateString('th-TH')}</p>
            ${content.innerHTML}
            <div style="margin-top:30px;text-align:center;">
                <button onclick="window.print()" style="padding:10px 20px;background:#4f46e5;color:#fff;border:none;border-radius:8px;cursor:pointer;">พิมพ์</button>
                <button onclick="window.close()" style="padding:10px 20px;background:#ef4444;color:#fff;border:none;border-radius:8px;cursor:pointer;">ปิด</button>
            </div>
        </body></html>
    `);
    win.document.close();
}

// ============================================================
//  STUDENT CRUD
// ============================================================
function openAddStudentModal() {
    document.getElementById('studentModalTitle').textContent = 'เพิ่มนักศึกษา';
    document.getElementById('modalStudentId').value = '';
    document.getElementById('modalStudentName').value = '';
    document.getElementById('modalEducationLevel').value = 'ปวช.1';
    document.getElementById('modalMajor').value = '';
    document.getElementById('modalClass').value = '';
    document.getElementById('modalShift').value = 'เช้า';
    document.getElementById('modalStudentId').disabled = false;
    document.getElementById('studentModal').classList.add('active');
}

function closeStudentModal() {
    document.getElementById('studentModal').classList.remove('active');
}

async function saveStudent() {
    const id = document.getElementById('modalStudentId').value.trim();
    const name = document.getElementById('modalStudentName').value.trim();
    const level = document.getElementById('modalEducationLevel').value;
    const major = document.getElementById('modalMajor').value.trim();
    const cls = document.getElementById('modalClass').value.trim();
    const shift = document.getElementById('modalShift').value;
    if (!id || !name || !level || !major) return showAlert('error', 'กรุณากรอกข้อมูลให้ครบ');

    // ถ้า ID ถูก disabled = โหมดแก้ไข, ถ้าไม่ถูก disabled = โหมดเพิ่ม
    const isEditing = document.getElementById('modalStudentId').disabled;
    const action = isEditing ? 'updateStudent' : 'addStudent';

    // บันทึกสถานะสำรองสำหรับกรณีเกิดข้อผิดพลาด (Rollback Backup)
    const previousStudents = JSON.parse(JSON.stringify(allStudents));

    // อัปเดตข้อมูลบนหน้าจอทันทีแบบ Optimistic UI (0ms Instant Feedback)
    if (isEditing) {
        const index = allStudents.findIndex(s => s.id === id);
        if (index !== -1) {
            allStudents[index] = {
                ...allStudents[index],
                name,
                studentName: name,
                level,
                educationLevel: level,
                major,
                class: cls,
                shift
            };
        }
    } else {
        const newStudent = {
            id,
            studentId: id,
            name,
            studentName: name,
            level,
            educationLevel: level,
            major,
            class: cls,
            shift,
            docs: '0/8',
            uploadedDocs: 0,
            totalDocs: 8
        };
        allStudents.unshift(newStudent);
    }
    
    applyFiltersAndRender(currentPage);
    closeStudentModal();
    showAlert('info', 'กำลังบันทึกไปยังเซิร์ฟเวอร์...');

    try {
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action, studentId: id, studentName: name, educationLevel: level,
                major, class: cls, shift }
        });
        if (result && result.success) {
            showAlert('success', isEditing ? '✅ แก้ไขนักศึกษาเรียบร้อย (ซิงค์เรียลไทม์)' : '✅ เพิ่มนักศึกษาเรียบร้อย (ซิงค์เรียลไทม์)');
            StorageCache.set('dashboard_data', { students: allStudents, statistics: null }, 300);
            cache.delete('all_students');
            loadStatistics().catch(() => {});
        } else {
            // ย้อนกลับหากเซิร์ฟเวอร์แจ้งผิดพลาด
            allStudents = previousStudents;
            applyFiltersAndRender(currentPage);
            showAlert('error', '❌ บันทึกไม่สำเร็จ: ' + (result?.message || 'เกิดข้อผิดพลาด'));
        }
    } catch (err) {
        // ย้อนกลับหากเชื่อมต่อล้มเหลว
        allStudents = previousStudents;
        applyFiltersAndRender(currentPage);
        showAlert('error', '❌ เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + err.message);
    }
}

async function editStudent(id) {
    try {
        const result = await callAPI(`${SCRIPT_URL}?action=getStudent&studentId=${id}`);
        if (result.success) {
            const s = result.data;
            document.getElementById('studentModalTitle').textContent = 'แก้ไขนักศึกษา';
            document.getElementById('modalStudentId').value = s.id;
            document.getElementById('modalStudentName').value = s.name;
            document.getElementById('modalEducationLevel').value = s.level;
            document.getElementById('modalMajor').value = s.major;
            document.getElementById('modalClass').value = s.class || '';
            document.getElementById('modalShift').value = s.shift || 'เช้า';
            document.getElementById('modalStudentId').disabled = true;
            document.getElementById('studentModal').classList.add('active');
        } else {
            showAlert('error', 'ไม่พบข้อมูล');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    }
}

async function deleteStudent(id) {
    if (!confirm(`ลบรหัส ${id} ใช่หรือไม่?`)) return;
    
    // บันทึกสถานะสำรอง
    const previousStudents = JSON.parse(JSON.stringify(allStudents));
    
    // ลบออกจากหน้าตารางทันที (0ms Instant UI response)
    allStudents = allStudents.filter(s => s.id !== id);
    applyFiltersAndRender(currentPage);
    showAlert('info', `กำลังลบรหัส ${id}...`);

    try {
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action: 'deleteStudent', studentId: id }
        });
        if (result && result.success) {
            showAlert('success', '✅ ลบสำเร็จ (ซิงค์เรียลไทม์)');
            StorageCache.set('dashboard_data', { students: allStudents, statistics: null }, 300);
            cache.delete('all_students');
            loadStatistics().catch(() => {});
        } else {
            allStudents = previousStudents;
            applyFiltersAndRender(currentPage);
            showAlert('error', '❌ ลบไม่สำเร็จ: ' + (result?.message || ''));
        }
    } catch (err) {
        allStudents = previousStudents;
        applyFiltersAndRender(currentPage);
        showAlert('error', '❌ เกิดข้อผิดพลาด: ' + err.message);
    }
}

// ============================================================
//  IMPORT / EXPORT
// ============================================================
function openImportModal() {
    document.getElementById('importModal').classList.add('active');
    document.getElementById('excelPreview').style.display = 'none';
    document.getElementById('excelFileInput').value = '';
}

function closeImportModal() {
    document.getElementById('importModal').classList.remove('active');
}

async function handleExcelFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const data = await readExcelFile(file);
        window.excelData = data;
        const preview = document.getElementById('excelPreview');
        const table = document.getElementById('excelPreviewTable');
        let html =
            '<thead><tr><th>รหัส</th><th>ชื่อ</th><th>ระดับ</th><th>สาขา</th><th>รอบ</th><th>ชั้นเรียน</th></tr></thead><tbody>';
        data.slice(0, 5).forEach(s => {
            html +=
                `<tr><td>${s.id}</td><td>${s.name}</td><td>${s.level}</td><td>${s.major}</td><td>${s.shift}</td><td>${s.class}</td></tr>`;
        });
        if (data.length > 5) html +=
            `<tr><td colspan="6" style="text-align:center;">และอื่นๆ อีก ${data.length - 5} รายการ</td></tr>`;
        html += '</tbody>';
        table.innerHTML = html;
        preview.style.display = 'block';
        showAlert('success', `อ่านไฟล์สำเร็จ ${data.length} รายการ`);
    } catch (err) {
        showAlert('error', 'อ่านไฟล์ไม่สำเร็จ: ' + err.message);
    }
}

function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const json = XLSX.utils.sheet_to_json(sheet);
                const students = json.map(row => ({
                    id: row['id']?.toString() || '',
                    name: row['name'] || '',
                    level: row['level'] || '',
                    major: row['major'] || '',
                    shift: row['round'] || row['shift'] || '',
                    class: row['class'] || ''
                })).filter(s => s.id && s.name);
                resolve(students);
            } catch (err) { reject(err); }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

async function confirmImport() {
    if (!window.excelData || window.excelData.length === 0) return showAlert('error', 'กรุณาเลือกไฟล์ Excel');
    try {
        showLoading(true);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action: 'importStudentsFromExcel', students: window.excelData }
        });
        if (result.success) {
            closeImportModal();
            showAlert('success', result.message);
            cache.delete('all_students');
            await loadStudentsTable();
            await loadStatistics();
            window.excelData = null;
        } else {
            showAlert('error', result.message || 'นำเข้าไม่สำเร็จ');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

async function importSampleData() {
    try {
        showLoading(true);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action: 'importSampleData' }
        });
        if (result.success) {
            showAlert('success', result.message);
            cache.delete('all_students');
            await loadStudentsTable();
            await loadStatistics();
        } else {
            showAlert('error', result.message || 'ไม่สำเร็จ');
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function exportToJSON() {
    const data = allStudents;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `students_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showAlert('success', 'ส่งออก JSON สำเร็จ');
}

function exportToExcel() {
    const sheetId = ConfigManager.getSpreadsheetId();
    window.open(
        `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`,
        '_blank');
    showAlert('info', 'กำลังเปิดไฟล์ Excel');
}

// ============================================================
//  BATCH OPERATIONS
// ============================================================
function updateSelectedCount() {
    const checked = document.querySelectorAll('.student-checkbox:checked');
    const count = checked.length;
    const btn = document.getElementById('bulkDeleteBtn');
    if (count > 0) {
        btn.style.display = 'inline-flex';
        document.getElementById('selectedCount').textContent = count;
    } else {
        btn.style.display = 'none';
    }
}

function selectAllStudents() {
    const cbs = document.querySelectorAll('.student-checkbox');
    const all = Array.from(cbs).every(cb => cb.checked);
    cbs.forEach(cb => cb.checked = !all);
    updateSelectedCount();
}

function clearSelection() {
    document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = false);
    updateSelectedCount();
}

async function bulkDeleteStudents() {
    const ids = Array.from(document.querySelectorAll('.student-checkbox:checked')).map(cb => cb.value);
    if (ids.length === 0) return showAlert('error', 'กรุณาเลือกนักศึกษา');
    if (!confirm(`ลบ ${ids.length} รายการ ใช่หรือไม่?`)) return;

    // บันทึกสถานะเดิม
    const previousStudents = JSON.parse(JSON.stringify(allStudents));

    // ลบออกจากหน้าตารางทันที (0ms Instant UI response)
    allStudents = allStudents.filter(s => !ids.includes(s.id));
    applyFiltersAndRender(currentPage);
    document.getElementById('bulkDeleteBtn').style.display = 'none';
    showAlert('info', `กำลังลบ ${ids.length} รายการ...`);

    try {
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action: 'bulkDeleteStudents', studentIds: ids }
        });
        if (result && result.success) {
            showAlert('success', result.message || '✅ ลบสำเร็จ (ซิงค์เรียลไทม์)');
            StorageCache.set('dashboard_data', { students: allStudents, statistics: null }, 300);
            cache.delete('all_students');
            loadStatistics().catch(() => {});
        } else {
            allStudents = previousStudents;
            applyFiltersAndRender(currentPage);
            showAlert('error', '❌ ลบไม่สำเร็จ: ' + (result?.message || ''));
        }
    } catch (err) {
        allStudents = previousStudents;
        applyFiltersAndRender(currentPage);
        showAlert('error', '❌ เกิดข้อผิดพลาด: ' + err.message);
    }
}

// ============================================================
//  FILTERS & SYSTEM
// ============================================================
function applyFilters() {
    const search = document.getElementById('adminSearchInput').value.trim();
    loadStudentsTable(1, search);
}

async function testSystem() {
    try {
        showLoading(true);
        const startTime = Date.now();
        const result = await callAPI(`${SCRIPT_URL}?action=test`);
        const latency = Date.now() - startTime;
        if (result && result.success) {
            showAlert('success', `✅ ระบบเชื่อมต่อปกติ (ความเร็ว: ${latency} ms)`);
            document.getElementById('statusDot').className = 'dot online';
            document.getElementById('connectionStatus').textContent = `ออนไลน์ (${latency}ms)`;
        } else {
            showAlert('warning', '⚠️ การเชื่อมต่อมีปัญหา: ' + (result?.message || ''));
            document.getElementById('statusDot').className = 'dot offline';
            document.getElementById('connectionStatus').textContent = 'มีปัญหา';
        }
    } catch (err) {
        showAlert('error', '❌ ทดสอบล้มเหลว: ' + err.message);
        document.getElementById('statusDot').className = 'dot offline';
        document.getElementById('connectionStatus').textContent = 'ออฟไลน์';
    } finally {
        showLoading(false);
    }
}

async function setupSheetStructure() {
    if (!confirm('ต้องการสร้าง/ปรับแต่งโครงสร้าง Google Sheet อัตโนมัติใช่หรือไม่?')) return;
    try {
        showLoading(true);
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: { action: 'autoSetupSheet' }
        });
        if (result && result.success) {
            showAlert('success', '✅ ' + (result.message || 'สร้างโครงสร้าง Sheet เรียบร้อยแล้ว'));
            StorageCache.clear();
            await loadDashboardData(true);
        } else {
            showAlert('error', '❌ ' + (result?.message || 'สร้างโครงสร้างไม่สำเร็จ'));
        }
    } catch (err) {
        showAlert('error', 'เกิดข้อผิดพลาด: ' + err.message);
    } finally {
        showLoading(false);
    }
}

async function refreshCache() {
    StorageCache.clear();
    showAlert('info', 'กำลังรีเฟรชข้อมูลล่าสุด...');
    await loadDashboardData(true);
    showAlert('success', 'รีเฟรชข้อมูลสำเร็จ');
}

// ============================================================
//  DATABASE & DEPLOYMENT CONFIGURATION MANAGEMENT
// ============================================================

function openConfigModal() {
    ConfigManager.load();
    document.getElementById('cfgScriptUrl').value = ConfigManager.getScriptUrl();
    document.getElementById('cfgSpreadsheetId').value = ConfigManager.getSpreadsheetId();
    document.getElementById('cfgSheetName').value = ConfigManager.getSheetName();
    document.getElementById('cfgDocumentsFolderId').value = ConfigManager.getDocumentsFolderId();
    
    updateConfigPreviews();
    
    const badge = document.getElementById('cfgPingBadge');
    badge.className = 'config-status-badge';
    badge.textContent = 'พร้อมทดสอบ';
    
    document.getElementById('configModal').classList.add('active');
}

function closeConfigModal() {
    document.getElementById('configModal').classList.remove('active');
}

function updateConfigPreviews() {
    const sheetVal = document.getElementById('cfgSpreadsheetId').value;
    const folderVal = document.getElementById('cfgDocumentsFolderId').value;
    
    const extractedSheet = ConfigManager.extractSpreadsheetId(sheetVal);
    const extractedFolder = ConfigManager.extractFolderId(folderVal);
    
    document.getElementById('cfgSheetIdDisplay').textContent = extractedSheet || '(ยังไม่ได้ระบุ)';
    document.getElementById('cfgFolderIdDisplay').textContent = extractedFolder || '(ยังไม่ได้ระบุ)';
}

async function testConfigConnection(customUrl = null) {
    const url = customUrl || document.getElementById('cfgScriptUrl').value.trim();
    if (!url) {
        return showAlert('error', 'กรุณาระบุ URL การดีพลอย Web App');
    }
    
    const badge = document.getElementById('cfgPingBadge');
    badge.className = 'config-status-badge testing';
    badge.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังทดสอบ...';
    
    try {
        const start = Date.now();
        const res = await callAPI(`${url}?action=test&_=${Date.now()}`, { timeout: 15000 });
        const latency = Date.now() - start;
        
        if (res && res.success) {
            badge.className = 'config-status-badge online';
            badge.innerHTML = `<i class="fas fa-check-circle"></i> เชื่อมต่อสำเร็จ (${latency} ms)`;
            showAlert('success', `✅ เชื่อมต่อ Google Apps Script สำเร็จ (ความเร็ว: ${latency} ms)`);
            document.getElementById('statusDot').className = 'dot online';
            document.getElementById('connectionStatus').textContent = `ออนไลน์ (${latency}ms)`;
            return true;
        } else {
            badge.className = 'config-status-badge offline';
            badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ตอบกลับผิดพลาด';
            showAlert('warning', '⚠️ การเชื่อมต่อมีปัญหา: ' + (res?.message || 'ไม่มีข้อความตอบกลับ'));
            return false;
        }
    } catch (err) {
        badge.className = 'config-status-badge offline';
        badge.innerHTML = '<i class="fas fa-times-circle"></i> เชื่อมต่อไม่สำเร็จ';
        showAlert('error', '❌ ไม่สามารถเชื่อมต่อ Web App ได้: ' + err.message);
        return false;
    }
}

function saveConfigFromModal() {
    const scriptUrl = document.getElementById('cfgScriptUrl').value.trim();
    const sheetId = document.getElementById('cfgSpreadsheetId').value.trim();
    const sheetName = document.getElementById('cfgSheetName').value.trim() || 'Students';
    const folderId = document.getElementById('cfgDocumentsFolderId').value.trim();
    
    if (!scriptUrl) {
        return showAlert('error', 'กรุณาระบุ Web App Deployment URL');
    }
    
    ConfigManager.save({
        scriptUrl: scriptUrl,
        spreadsheetId: sheetId,
        sheetName: sheetName,
        documentsFolderId: folderId
    });
    
    StorageCache.clear();
    closeConfigModal();
    showAlert('success', '💾 บันทึกการตั้งค่าระบบเรียบร้อยแล้ว');
    
    // โหลดข้อมูลใหม่ตามคอนฟิกที่บันทึก
    loadDashboardData(true).catch(() => {});
}

async function syncBackendSetup() {
    const scriptUrl = document.getElementById('cfgScriptUrl').value.trim();
    const sheetId = ConfigManager.extractSpreadsheetId(document.getElementById('cfgSpreadsheetId').value);
    const sheetName = document.getElementById('cfgSheetName').value.trim() || 'Students';
    const folderId = ConfigManager.extractFolderId(document.getElementById('cfgDocumentsFolderId').value);
    
    if (!scriptUrl) {
        return showAlert('error', 'กรุณาระบุ Web App Deployment URL ก่อนซิงค์');
    }
    
    if (!sheetId) {
        return showAlert('error', 'กรุณาระบุ Google Sheet ID หรือ ลิงก์ Google Sheets');
    }
    
    // บันทึกลง Client ก่อน
    ConfigManager.save({
        scriptUrl: scriptUrl,
        spreadsheetId: sheetId,
        sheetName: sheetName,
        documentsFolderId: folderId
    });
    
    try {
        showLoading(true);
        showAlert('info', 'กำลังสั่งให้ Google Apps Script ปรับปรุงโครงสร้าง Sheet และตั้งค่าปลายทาง...');
        
        const payload = {
            action: 'saveSystemConfig',
            spreadsheetId: sheetId,
            sheetName: sheetName,
            documentsFolderId: folderId
        };
        
        const res = await callAPI(scriptUrl, {
            method: 'POST',
            body: payload
        });
        
        if (res && res.success) {
            showAlert('success', '⚡ ซิงค์และสร้างโครงสร้าง Google Sheet อัตโนมัติสำเร็จ!');
            StorageCache.clear();
            closeConfigModal();
            await loadDashboardData(true);
        } else {
            // Fallback รัน autoSetupSheet หาก backend เป็นรุ่นเดิม
            const fallbackRes = await callAPI(scriptUrl, {
                method: 'POST',
                body: { action: 'autoSetupSheet' }
            });
            if (fallbackRes && fallbackRes.success) {
                showAlert('success', '⚡ สร้างโครงสร้าง Sheet สำเร็จ (โหมดรองรับมาตรฐาน)');
                StorageCache.clear();
                closeConfigModal();
                await loadDashboardData(true);
            } else {
                showAlert('warning', '⚠️ การซิงค์อาจมีข้อผิดพลาด: ' + (res?.message || fallbackRes?.message || 'ตรวจสอบสิทธิ์ของ Web App'));
            }
        }
    } catch (err) {
        showAlert('error', '❌ ซิงค์ไม่สำเร็จ: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function resetConfigToDefault() {
    if (!confirm('ต้องการคืนค่าการเชื่อมต่อเริ่มต้นของระบบใช่หรือไม่?')) return;
    ConfigManager.reset();
    document.getElementById('cfgScriptUrl').value = DEFAULT_CONFIG.scriptUrl;
    document.getElementById('cfgSpreadsheetId').value = DEFAULT_CONFIG.spreadsheetId;
    document.getElementById('cfgSheetName').value = DEFAULT_CONFIG.sheetName;
    document.getElementById('cfgDocumentsFolderId').value = DEFAULT_CONFIG.documentsFolderId;
    updateConfigPreviews();
    showAlert('info', '🔄 คืนค่าเริ่มต้นเรียบร้อยแล้ว อย่าลืมกด "บันทึกการตั้งค่า"');
}

function openConfigSheet() {
    const raw = document.getElementById('cfgSpreadsheetId').value;
    const id = ConfigManager.extractSpreadsheetId(raw);
    if (!id) return showAlert('error', 'กรุณาระบุ Google Sheet ID ก่อน');
    window.open(`https://docs.google.com/spreadsheets/d/${id}/edit`, '_blank');
}

function openConfigFolder() {
    const raw = document.getElementById('cfgDocumentsFolderId').value;
    const id = ConfigManager.extractFolderId(raw);
    if (!id) return showAlert('error', 'กรุณาระบุ Google Drive Folder ID ก่อน');
    window.open(`https://drive.google.com/drive/folders/${id}`, '_blank');
}

async function copyGasCode() {
    try {
        const text = `// ดูโค้ด Google Apps Script ทั้งหมดได้ในไฟล์ GAS.txt ของโปรเจกต์
// ให้คัดลอกเนื้อหาทั้งหมดในไฟล์ GAS.txt ไปวางใน Extensions > Apps Script บน Google Sheets
// แล้วคลิก 'ทำให้ใช้งานได้ (Deploy)' > 'การทำให้ใช้งานได้ใหม่ (New deployment)' > 'เว็บแอปพลิเคชัน (Web app)'
// ผู้มีสิทธิ์เข้าถึง: 'ทุกคน (Anyone)'`;
        await navigator.clipboard.writeText(text);
        showAlert('success', '📋 คัดลอกคำแนะนำโค้ด GAS เรียบร้อยแล้ว (ไฟล์ GAS.txt พร้อมใช้งานในโฟลเดอร์โปรเจกต์)');
    } catch (e) {
        showAlert('info', 'ℹ️ สามารถเปิดดูโค้ดเต็มได้จากไฟล์ GAS.txt ในโฟลเดอร์โปรเจกต์');
    }
}

// ============================================================
//  MODE SWITCH
// ============================================================
function switchMode(mode) {
    currentMode = mode;
    document.getElementById('visitorModeBtn').classList.toggle('active', mode === 'visitor');
    document.getElementById('adminModeBtn').classList.toggle('active', mode === 'admin');
    document.getElementById('visitorMode').style.display = mode === 'visitor' ? 'block' : 'none';
    document.getElementById('adminMode').style.display = mode === 'admin' ? 'block' : 'none';
    document.getElementById('studentData').style.display = 'none';
    if (mode === 'admin') {
        if (isAdminLoggedIn) {
            document.getElementById('adminLoginForm').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'block';
            loadDashboardData(false);
        } else {
            document.getElementById('adminLoginForm').style.display = 'block';
            document.getElementById('adminPanel').style.display = 'none';
        }
    }
}

// ============================================================
//  INIT & EVENT LISTENERS
// ============================================================
let searchDebounceTimer = null;

function setupEventListeners() {
    // Mode switches
    document.getElementById('visitorModeBtn').addEventListener('click', () => switchMode('visitor'));
    document.getElementById('adminModeBtn').addEventListener('click', () => switchMode('admin'));

    // Config Modal
    const headerSettingsBtn = document.getElementById('headerSettingsBtn');
    if (headerSettingsBtn) headerSettingsBtn.addEventListener('click', openConfigModal);
    const openConfigBtn = document.getElementById('openConfigBtn');
    if (openConfigBtn) openConfigBtn.addEventListener('click', openConfigModal);
    const closeConfigBtn = document.getElementById('closeConfigModal');
    if (closeConfigBtn) closeConfigBtn.addEventListener('click', closeConfigModal);

    // Config inputs dynamic ID extraction
    const cfgSpreadsheet = document.getElementById('cfgSpreadsheetId');
    if (cfgSpreadsheet) {
        cfgSpreadsheet.addEventListener('input', updateConfigPreviews);
        cfgSpreadsheet.addEventListener('change', updateConfigPreviews);
    }
    const cfgFolder = document.getElementById('cfgDocumentsFolderId');
    if (cfgFolder) {
        cfgFolder.addEventListener('input', updateConfigPreviews);
        cfgFolder.addEventListener('change', updateConfigPreviews);
    }

    // Config buttons
    const cfgTestBtn = document.getElementById('cfgTestBtn');
    if (cfgTestBtn) cfgTestBtn.addEventListener('click', () => testConfigConnection());
    const cfgOpenSheet = document.getElementById('cfgOpenSheetBtn');
    if (cfgOpenSheet) cfgOpenSheet.addEventListener('click', openConfigSheet);
    const cfgOpenFolder = document.getElementById('cfgOpenFolderBtn');
    if (cfgOpenFolder) cfgOpenFolder.addEventListener('click', openConfigFolder);
    const cfgSaveBtn = document.getElementById('cfgSaveBtn');
    if (cfgSaveBtn) cfgSaveBtn.addEventListener('click', saveConfigFromModal);
    const cfgSyncSetupBtn = document.getElementById('cfgSyncSetupBtn');
    if (cfgSyncSetupBtn) cfgSyncSetupBtn.addEventListener('click', syncBackendSetup);
    const cfgResetBtn = document.getElementById('cfgResetBtn');
    if (cfgResetBtn) cfgResetBtn.addEventListener('click', resetConfigToDefault);
    const cfgCopyGasBtn = document.getElementById('cfgCopyGasBtn');
    if (cfgCopyGasBtn) cfgCopyGasBtn.addEventListener('click', copyGasCode);

    // Search
    document.getElementById('searchBtn').addEventListener('click', searchStudent);
    document.getElementById('searchInput').addEventListener('keypress', e => e.key === 'Enter' && searchStudent());

    // Admin login
    document.getElementById('adminLoginBtn').addEventListener('click', adminLogin);
    document.getElementById('adminPassword').addEventListener('keypress', e => e.key === 'Enter' && adminLogin());

    // Admin logout
    document.getElementById('adminLogoutBtn').addEventListener('click', adminLogout);

    // Admin search (Instant Live Search Debounced 150ms + Enter)
    document.getElementById('adminSearchBtn').addEventListener('click', applyFilters);
    document.getElementById('adminSearchInput').addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            applyFilters();
        }, 150);
    });
    document.getElementById('adminSearchInput').addEventListener('keypress', e => e.key === 'Enter' && applyFilters());

    // Filters (Instant on change)
    document.getElementById('applyFilterBtn').addEventListener('click', applyFilters);
    ['filterLevel', 'filterMajor', 'filterShift', 'filterDocStatus'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', applyFilters);
    });

    // Modal closes
    document.getElementById('closeUploadModal').addEventListener('click', closeUploadModal);
    document.getElementById('closeStudentModal').addEventListener('click', closeStudentModal);
    document.getElementById('closeDocumentViewModal').addEventListener('click', closeDocumentViewModal);
    document.getElementById('closeImportModal').addEventListener('click', closeImportModal);
    const closeAdminDocs = document.getElementById('closeAdminDocsModal');
    if (closeAdminDocs) closeAdminDocs.addEventListener('click', closeAdminDocsModal);
    const closeAdminDocsBtn = document.getElementById('closeAdminDocsModalBtn');
    if (closeAdminDocsBtn) closeAdminDocsBtn.addEventListener('click', closeAdminDocsModal);
    const adminDeleteAllDocsBtn = document.getElementById('adminDeleteAllDocsBtn');
    if (adminDeleteAllDocsBtn) adminDeleteAllDocsBtn.addEventListener('click', adminDeleteAllDocs);

    // Health Check Modal & Actions
    const healthCheckBtn = document.getElementById('healthCheckBtn');
    if (healthCheckBtn) healthCheckBtn.addEventListener('click', openHealthCheckModal);
    const closeHealthCheckModalBtn = document.getElementById('closeHealthCheckModal');
    if (closeHealthCheckModalBtn) closeHealthCheckModalBtn.addEventListener('click', closeHealthCheckModal);
    const closeHealthCheckBtn = document.getElementById('closeHealthCheckModalBtn');
    if (closeHealthCheckBtn) closeHealthCheckBtn.addEventListener('click', closeHealthCheckModal);
    const runHealthCheckBtn = document.getElementById('runHealthCheckBtn');
    if (runHealthCheckBtn) runHealthCheckBtn.addEventListener('click', runSystemHealthCheck);
    const autoRepairBtn = document.getElementById('autoRepairBtn');
    if (autoRepairBtn) autoRepairBtn.addEventListener('click', () => executeSystemRepair('all'));
    const cleanOrphansBtn = document.getElementById('cleanOrphansBtn');
    if (cleanOrphansBtn) cleanOrphansBtn.addEventListener('click', () => executeSystemRepair('orphans'));
    const fixSharingBtn = document.getElementById('fixSharingBtn');
    if (fixSharingBtn) fixSharingBtn.addEventListener('click', () => executeSystemRepair('permissions'));

    // Database Backup & Restore Modal & Actions
    const backupRestoreBtn = document.getElementById('backupRestoreBtn');
    if (backupRestoreBtn) backupRestoreBtn.addEventListener('click', openBackupModal);
    const closeBackupModalBtn = document.getElementById('closeBackupRestoreModal');
    if (closeBackupModalBtn) closeBackupModalBtn.addEventListener('click', closeBackupModal);
    const closeBackupBtn = document.getElementById('closeBackupRestoreModalBtn');
    if (closeBackupBtn) closeBackupBtn.addEventListener('click', closeBackupModal);
    const createSnapshotBtn = document.getElementById('createSnapshotBtn');
    if (createSnapshotBtn) createSnapshotBtn.addEventListener('click', createSnapshotNow);
    const refreshBackupsBtn = document.getElementById('refreshBackupsBtn');
    if (refreshBackupsBtn) refreshBackupsBtn.addEventListener('click', loadBackupSnapshots);
    const downloadFullJsonBackupBtn = document.getElementById('downloadFullJsonBackupBtn');
    if (downloadFullJsonBackupBtn) downloadFullJsonBackupBtn.addEventListener('click', downloadFullJsonBackup);
    const selectRestoreJsonFileBtn = document.getElementById('selectRestoreJsonFileBtn');
    if (selectRestoreJsonFileBtn) selectRestoreJsonFileBtn.addEventListener('click', () => document.getElementById('restoreJsonFileInput').click());
    const restoreJsonFileInput = document.getElementById('restoreJsonFileInput');
    if (restoreJsonFileInput) restoreJsonFileInput.addEventListener('change', handleRestoreJsonFileSelect);

    // Student Direct Link & QR Code Actions
    const copyDirectLinkBtn = document.getElementById('copyDirectLinkBtn');
    if (copyDirectLinkBtn) copyDirectLinkBtn.addEventListener('click', () => copyStudentDirectLink());
    const showStudentQrBtn = document.getElementById('showStudentQrBtn');
    if (showStudentQrBtn) showStudentQrBtn.addEventListener('click', () => openStudentQrModal());
    const closeQrCodeModalBtn = document.getElementById('closeQrCodeModal');
    if (closeQrCodeModalBtn) closeQrCodeModalBtn.addEventListener('click', closeQrCodeModal);
    const closeQrCodeBtn = document.getElementById('closeQrCodeModalBtn');
    if (closeQrCodeBtn) closeQrCodeBtn.addEventListener('click', closeQrCodeModal);
    const copyQrLinkBtn = document.getElementById('copyQrLinkBtn');
    if (copyQrLinkBtn) copyQrLinkBtn.addEventListener('click', () => copyStudentDirectLink(currentQrStudent ? (currentQrStudent.id || currentQrStudent.studentId) : null));
    const downloadQrPngBtn = document.getElementById('downloadQrPngBtn');
    if (downloadQrPngBtn) downloadQrPngBtn.addEventListener('click', downloadQrPng);
    const printQrCardBtn = document.getElementById('printQrCardBtn');
    if (printQrCardBtn) printQrCardBtn.addEventListener('click', printQrCard);

    // Audit Logs Modal & Actions
    const auditLogsBtn = document.getElementById('auditLogsBtn');
    if (auditLogsBtn) auditLogsBtn.addEventListener('click', openAuditLogsModal);
    const closeAuditLogsModalBtn = document.getElementById('closeAuditLogsModal');
    if (closeAuditLogsModalBtn) closeAuditLogsModalBtn.addEventListener('click', closeAuditLogsModal);
    const closeAuditLogsBtn = document.getElementById('closeAuditLogsModalBtn');
    if (closeAuditLogsBtn) closeAuditLogsBtn.addEventListener('click', closeAuditLogsModal);
    const refreshLogsBtn = document.getElementById('refreshLogsBtn');
    if (refreshLogsBtn) refreshLogsBtn.addEventListener('click', loadAuditLogs);
    const clearLogsBtn = document.getElementById('clearLogsBtn');
    if (clearLogsBtn) clearLogsBtn.addEventListener('click', clearAllAuditLogs);
    const exportLogsJsonBtn = document.getElementById('exportLogsJsonBtn');
    if (exportLogsJsonBtn) exportLogsJsonBtn.addEventListener('click', exportLogsToJSON);
    const logSearchInput = document.getElementById('logSearchInput');
    if (logSearchInput) logSearchInput.addEventListener('input', filterAuditLogs);
    const logActionFilter = document.getElementById('logActionFilter');
    if (logActionFilter) logActionFilter.addEventListener('change', filterAuditLogs);

    // Change Admin Password Modal & Actions
    const changePassBtn = document.getElementById('changePassBtn');
    if (changePassBtn) changePassBtn.addEventListener('click', openChangePasswordModal);
    const closeChangePassModalBtn = document.getElementById('closeChangePassModal');
    if (closeChangePassModalBtn) closeChangePassModalBtn.addEventListener('click', closeChangePasswordModal);
    const closeChangePassBtn = document.getElementById('closeChangePassBtn');
    if (closeChangePassBtn) closeChangePassBtn.addEventListener('click', closeChangePasswordModal);
    const saveNewPasswordBtn = document.getElementById('saveNewPasswordBtn');
    if (saveNewPasswordBtn) saveNewPasswordBtn.addEventListener('click', saveNewAdminPassword);

    // Upload
    document.getElementById('dropZone').addEventListener('click', () => document.getElementById('fileInput').click());
    document.getElementById('fileInput').addEventListener('change', handleFileSelect);
    document.getElementById('confirmUploadBtn').addEventListener('click', confirmUpload);

    // Student CRUD
    document.getElementById('addStudentBtn').addEventListener('click', openAddStudentModal);
    document.getElementById('saveStudentBtn').addEventListener('click', saveStudent);

    // Import
    document.getElementById('importFromExcelBtn').addEventListener('click', openImportModal);
    document.getElementById('excelDropZone').addEventListener('click', () => document.getElementById('excelFileInput').click());
    document.getElementById('excelFileInput').addEventListener('change', handleExcelFileSelect);
    document.getElementById('confirmImportBtn').addEventListener('click', confirmImport);
    document.getElementById('importSampleDataBtn').addEventListener('click', importSampleData);

    // Export
    document.getElementById('exportJsonBtn').addEventListener('click', exportToJSON);
    document.getElementById('exportExcelBtn').addEventListener('click', exportToExcel);

    // Report & System
    document.getElementById('generateReportBtn').addEventListener('click', generateReport);
    document.getElementById('testSystemBtn').addEventListener('click', testSystem);
    document.getElementById('refreshCacheBtn').addEventListener('click', refreshCache);
    const setupBtn = document.getElementById('setupSheetBtn');
    if (setupBtn) setupBtn.addEventListener('click', setupSheetStructure);

    // Batch
    document.getElementById('selectAllBtn').addEventListener('click', selectAllStudents);
    document.getElementById('clearSelectionBtn').addEventListener('click', clearSelection);
    document.getElementById('bulkDeleteBtn').addEventListener('click', bulkDeleteStudents);
    document.getElementById('selectAllCheckbox').addEventListener('change', function() {
        document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = this.checked);
        updateSelectedCount();
    });

    // Delete document
    document.getElementById('deleteDocumentBtn').addEventListener('click', deleteCurrentDocument);

    // Table event delegation
    document.getElementById('studentsTableBody').addEventListener('click', function(e) {
        const btn = e.target.closest('.action-btn');
        if (!btn) return;
        const id = btn.dataset.id;
        if (!id) return;
        if (btn.classList.contains('view-details')) {
            currentStudentId = id;
            document.getElementById('searchInput').value = id;
            searchStudent();
            switchMode('visitor');
        } else if (btn.classList.contains('show-qr')) {
            openStudentQrModal(id);
        } else if (btn.classList.contains('manage-docs')) {
            openAdminDocsModal(id);
        } else if (btn.classList.contains('edit-student')) {
            editStudent(id);
        } else if (btn.classList.contains('delete-student')) {
            deleteStudent(id);
        }
    });

    document.getElementById('studentsTableBody').addEventListener('change', function(e) {
        if (e.target.classList.contains('student-checkbox')) updateSelectedCount();
    });

    // Drag & drop
    ['dropZone', 'excelDropZone', 'extraDocDropZone'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('dragover', e => { e.preventDefault();
            el.classList.add('dragover'); });
        el.addEventListener('dragleave', e => { e.preventDefault();
            el.classList.remove('dragover'); });
        el.addEventListener('drop', e => {
            e.preventDefault();
            el.classList.remove('dragover');
            const input = el.querySelector('.file-input');
            if (input && e.dataTransfer.files.length) {
                input.files = e.dataTransfer.files;
                input.dispatchEvent(new Event('change'));
            }
        });
    });

    // Upload Extra Doc Modal
    const openExtraBtn = document.getElementById('openUploadExtraDocBtn');
    if (openExtraBtn) openExtraBtn.addEventListener('click', openUploadExtraDocModal);

    const closeExtraModal = document.getElementById('closeUploadExtraDocModal');
    if (closeExtraModal) closeExtraModal.addEventListener('click', closeUploadExtraDocModal);

    const closeExtraModalBtn = document.getElementById('closeUploadExtraDocModalBtn');
    if (closeExtraModalBtn) closeExtraModalBtn.addEventListener('click', closeUploadExtraDocModal);

    const confirmExtraBtn = document.getElementById('confirmUploadExtraDocBtn');
    if (confirmExtraBtn) confirmExtraBtn.addEventListener('click', confirmUploadExtraDoc);

    const extraFileInput = document.getElementById('extraDocFileInput');
    if (extraFileInput) extraFileInput.addEventListener('change', handleExtraDocFileSelect);

    const extraDropZone = document.getElementById('extraDocDropZone');
    if (extraDropZone) {
        extraDropZone.addEventListener('click', () => {
            const fi = document.getElementById('extraDocFileInput');
            if (fi) fi.click();
        });
    }
}

function restoreAdminSession() {
    if (localStorage.getItem('adminLoggedIn') === 'true') {
        isAdminLoggedIn = true;
        document.getElementById('adminLoginForm').style.display = 'none';
        document.getElementById('adminPanel').style.display = 'block';
        loadDashboardData(false);
    }
}

function init() {
    ConfigManager.init();
    RealTimeEngine.init();
    switchMode('visitor');
    restoreAdminSession();
    setupEventListeners();
    
    // Check URL query parameters for Direct Link (e.g. ?studentId=26737)
    const urlParams = new URLSearchParams(window.location.search);
    const directStudentId = urlParams.get('studentId') || urlParams.get('id') || urlParams.get('query');
    if (directStudentId) {
        switchMode('visitor');
        document.getElementById('searchInput').value = directStudentId;
        setTimeout(() => {
            searchStudent();
        }, 300);
    } else {
        // Pre-load dashboard cache in background non-blocking
        loadDashboardData(false).catch(() => {});
    }
    
    showAlert('info', '🚀 ระบบพร้อมใช้งาน (ความเร็วสูง & ซิงค์เรียลไทม์)', 2000);
}

document.addEventListener('DOMContentLoaded', init);

// Expose to global for inline onclick
window.searchStudent = searchStudent;
window.viewDocument = viewDocument;
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.openAdminDocsModal = openAdminDocsModal;
window.closeAdminDocsModal = closeAdminDocsModal;
window.deleteDocumentDirect = deleteDocumentDirect;
window.deleteDocumentFromAdminModal = deleteDocumentFromAdminModal;
window.adminDeleteAllDocs = adminDeleteAllDocs;
window.closeDocumentViewModal = closeDocumentViewModal;
window.clearFileSelection = clearFileSelection;
window.printReport = printReport;
window.loadStudentsTable = loadStudentsTable;
window.applyFilters = applyFilters;
window.editStudent = editStudent;
window.deleteStudent = deleteStudent;
window.selectAllStudents = selectAllStudents;
window.clearSelection = clearSelection;
window.bulkDeleteStudents = bulkDeleteStudents;
window.confirmUpload = confirmUpload;
window.saveStudent = saveStudent;
window.openAddStudentModal = openAddStudentModal;
window.closeStudentModal = closeStudentModal;
window.importSampleData = importSampleData;
window.confirmImport = confirmImport;
window.closeImportModal = closeImportModal;
window.exportToJSON = exportToJSON;
window.exportToExcel = exportToExcel;
window.generateReport = generateReport;
window.testSystem = testSystem;
window.refreshCache = refreshCache;
window.setupSheetStructure = setupSheetStructure;
window.adminLogin = adminLogin;
window.adminLogout = adminLogout;
window.switchMode = switchMode;
window.openConfigModal = openConfigModal;
window.closeConfigModal = closeConfigModal;
window.saveConfigFromModal = saveConfigFromModal;
window.syncBackendSetup = syncBackendSetup;
window.resetConfigToDefault = resetConfigToDefault;
window.testConfigConnection = testConfigConnection;
window.openConfigSheet = openConfigSheet;
window.openConfigFolder = openConfigFolder;
window.copyGasCode = copyGasCode;
window.openHealthCheckModal = openHealthCheckModal;
window.closeHealthCheckModal = closeHealthCheckModal;
window.runSystemHealthCheck = runSystemHealthCheck;
window.executeSystemRepair = executeSystemRepair;
window.openAuditLogsModal = openAuditLogsModal;
window.closeAuditLogsModal = closeAuditLogsModal;
window.loadAuditLogs = loadAuditLogs;
window.filterAuditLogs = filterAuditLogs;
window.clearAllAuditLogs = clearAllAuditLogs;
window.exportLogsToJSON = exportLogsToJSON;
window.openChangePasswordModal = openChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.saveNewAdminPassword = saveNewAdminPassword;
window.openBackupModal = openBackupModal;
window.closeBackupModal = closeBackupModal;
window.loadBackupSnapshots = loadBackupSnapshots;
window.createSnapshotNow = createSnapshotNow;
window.restoreSnapshot = restoreSnapshot;
window.deleteSnapshot = deleteSnapshot;
window.downloadFullJsonBackup = downloadFullJsonBackup;
window.openStudentQrModal = openStudentQrModal;
window.closeQrCodeModal = closeQrCodeModal;
window.copyStudentDirectLink = copyStudentDirectLink;
window.downloadQrPng = downloadQrPng;
window.printQrCard = printQrCard;
window.openUploadExtraDocModal = openUploadExtraDocModal;
window.closeUploadExtraDocModal = closeUploadExtraDocModal;
window.handleExtraDocFileSelect = handleExtraDocFileSelect;
window.confirmUploadExtraDoc = confirmUploadExtraDoc;
window.deleteExtraDoc = deleteExtraDoc;
window.viewExtraDoc = viewExtraDoc;
