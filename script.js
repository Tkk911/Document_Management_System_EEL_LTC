// ==================== GLOBAL VARIABLES ====================
let currentMode = 'visitor';
let currentStudentId = null;
let currentDocumentType = null;
let currentGuardianType = null;
let selectedFile = null;
let isAdminLoggedIn = false;
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxxNSMZB3z5QOIwnJhUT-CoLKPKyByPF1ClEx6Fe7f_JZVdiUuJUKxiVd9ci0I06Bnapw/exec';

// ==================== CACHE SYSTEM ====================
class DataCache {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 10 * 60 * 1000;
        this.hits = 0;
        this.misses = 0;
    }

    set(key, data, customTimeout = null) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now(),
            timeout: customTimeout || this.cacheTimeout
        });
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) {
            this.misses++;
            return null;
        }
        if (Date.now() - item.timestamp > item.timeout) {
            this.cache.delete(key);
            this.misses++;
            return null;
        }
        this.hits++;
        return item.data;
    }

    clear() { this.cache.clear(); this.hits = 0; this.misses = 0; }
    delete(key) { this.cache.delete(key); }

    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now - item.timestamp > item.timeout) this.cache.delete(key);
        }
    }

    getStats() {
        const total = this.hits + this.misses;
        const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(1) : 0;
        return { hits: this.hits, misses: this.misses, hitRate: hitRate, size: this.cache.size };
    }
}

// ==================== PAGINATION SYSTEM ====================
class PaginationSystem {
    constructor(pageSize = 50) {
        this.currentPage = 1;
        this.pageSize = pageSize;
        this.totalItems = 0;
        this.allStudents = [];
        this.searchQuery = '';
        this.filteredStudents = [];
    }

    async loadPage(page = 1, searchQuery = '') {
        this.currentPage = page;
        this.searchQuery = searchQuery;
        try {
            let result;
            if (searchQuery) {
                result = await callAPI(`${SCRIPT_URL}?action=searchStudents&query=${encodeURIComponent(searchQuery)}&page=${page}&pageSize=${this.pageSize}`);
            } else {
                result = await callAPI(`${SCRIPT_URL}?action=getStudentsPage&page=${page}&pageSize=${this.pageSize}`);
            }
            if (result.success) {
                this.filteredStudents = result.data.students || [];
                this.totalItems = result.data.totalCount || this.filteredStudents.length;
                return this.filteredStudents;
            }
        } catch (error) {
            console.error('Error loading page:', error);
            return this.getCurrentPageStudents();
        }
        return [];
    }

    getCurrentPageStudents() {
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        return this.filteredStudents.slice(startIndex, endIndex);
    }

    setStudents(students) {
        this.filteredStudents = students;
        this.allStudents = students;
        this.totalItems = students.length;
    }

    getTotalPages() { return Math.ceil(this.totalItems / this.pageSize); }
    hasNextPage() { return this.currentPage < this.getTotalPages(); }
    hasPreviousPage() { return this.currentPage > 1; }
}

// ==================== BACKGROUND SYNC ====================
class BackgroundSync {
    constructor() {
        this.syncInterval = 3 * 60 * 1000;
        this.isSyncing = false;
        this.lastSync = null;
    }
    
    start() {
        setInterval(() => this.syncData(), this.syncInterval);
        window.addEventListener('online', () => this.syncData());
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.syncData();
        });
    }
    
    async syncData() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        try {
            console.log('🔄 Background sync started...');
            const result = await callAPI(`${SCRIPT_URL}?action=getAllStudents&_=${Date.now()}`);
            if (result && result.success) {
                dataCache.set('all_students', result);
                this.lastSync = new Date();
                console.log('✅ Background sync completed');
                updateCacheStatus();
            }
        } catch (error) {
            console.log('⚠️ Background sync failed:', error);
        } finally {
            this.isSyncing = false;
        }
    }
    
    getLastSyncTime() {
        return this.lastSync ? this.lastSync.toLocaleTimeString('th-TH') : 'ยังไม่มีการซิงค์';
    }
}

// ==================== INITIALIZE SYSTEMS ====================
const dataCache = new DataCache();
const pagination = new PaginationSystem(50);
const backgroundSync = new BackgroundSync();
setInterval(() => dataCache.cleanup(), 60000);

// ==================== API FUNCTIONS ====================
async function callAPI(url, options = {}) {
    const startTime = Date.now();
    try {
        console.log('📡 Calling API:', url);
        const defaultOptions = {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000
        };
        const mergedOptions = { ...defaultOptions, ...options, headers: { ...defaultOptions.headers, ...options.headers } };
        const finalUrl = url.includes('?') ? `${url}&_=${Date.now()}` : `${url}?_=${Date.now()}`;
        
        const fetchPromise = fetch(finalUrl, mergedOptions);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 15s')), 15000));
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (parseError) {
            console.error('❌ JSON parse error:', parseError, 'Response text:', text);
            throw new Error('Invalid JSON response from server');
        }
        const endTime = Date.now();
        console.log(`✅ API Response in ${endTime - startTime}ms:`, result);
        return result;
    } catch (error) {
        console.error('❌ API call failed:', error);
        if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
            return await callAPIAlternative(url, options);
        }
        throw error;
    }
}

async function callAPIAlternative(url, options = {}) {
    try {
        console.log('🔄 Using alternative API call method...');
        if (options.method === 'GET' || !options.method) {
            return await callAPIViaProxy(url, options);
        } else {
            return await callAPIViaForm(url, options);
        }
    } catch (error) {
        console.error('Alternative method failed:', error);
        throw new Error('All API methods failed: ' + error.message);
    }
}

async function callAPIViaProxy(url, options = {}) {
    try {
        const proxyUrls = [
            'https://cors-anywhere.herokuapp.com/',
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ];
        let proxyResponse;
        for (const proxyUrl of proxyUrls) {
            try {
                const fullUrl = proxyUrl + encodeURIComponent(url);
                console.log('🔧 Trying proxy URL:', fullUrl);
                const response = await fetch(fullUrl, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 15000
                });
                if (response.ok) {
                    const text = await response.text();
                    proxyResponse = JSON.parse(text);
                    console.log('✅ Proxy method successful');
                    break;
                }
            } catch (proxyError) {
                console.log(`Proxy ${proxyUrl} failed:`, proxyError);
                continue;
            }
        }
        if (proxyResponse) return proxyResponse;
        else throw new Error('All proxies failed');
    } catch (error) {
        console.error('Proxy method failed:', error);
        throw error;
    }
}

async function callAPIViaForm(url, options = {}) {
    try {
        console.log('📝 Using FormData method for POST...');
        const formData = new FormData();
        let requestData = {};
        if (options.body) {
            try {
                requestData = JSON.parse(options.body);
                for (const key in requestData) {
                    if (requestData.hasOwnProperty(key)) formData.append(key, requestData[key]);
                }
            } catch (e) {
                console.error('Error parsing body for FormData:', e);
                throw e;
            }
        }
        const response = await fetch(url, { method: 'POST', body: formData });
        if (!response.ok) throw new Error(`FormData HTTP error! status: ${response.status}`);
        const text = await response.text();
        return JSON.parse(text);
    } catch (error) {
        console.error('FormData method failed:', error);
        throw error;
    }
}

// ==================== CACHE-ENHANCED FUNCTIONS ====================
async function searchStudentWithCache(searchValue, forceRefresh = false) {
    const cacheKey = `search_${searchValue}`;
    if (!forceRefresh) {
        const cachedData = dataCache.get(cacheKey);
        if (cachedData) {
            console.log('📦 Using cached search data for:', searchValue);
            return cachedData;
        }
    }
    try {
        const result = await callAPI(`${SCRIPT_URL}?action=searchStudent&query=${encodeURIComponent(searchValue)}`);
        if (result.success) {
            dataCache.set(cacheKey, result, 5 * 60 * 1000);
            return result;
        } else {
            throw new Error(result.message || 'ไม่พบข้อมูลนักศึกษา');
        }
    } catch (error) {
        console.error('Error searching student:', error);
        throw error;
    }
}

async function loadAllStudentsWithCache(forceRefresh = false) {
    const cacheKey = 'all_students';
    if (!forceRefresh) {
        const cachedData = dataCache.get(cacheKey);
        if (cachedData) {
            console.log('📦 Using cached all students data');
            return cachedData;
        }
    }
    try {
        const result = await callAPI(`${SCRIPT_URL}?action=getAllStudents`);
        if (result && result.success) {
            dataCache.set(cacheKey, result);
            return result;
        } else {
            throw new Error('Failed to load students');
        }
    } catch (error) {
        console.error('Error loading students:', error);
        throw error;
    }
}

// ==================== MAIN FUNCTIONS ====================
async function searchStudent() {
    const searchValue = document.getElementById('searchInput').value.trim();
    if (!searchValue) {
        showAlert('error', 'กรุณาป้อนรหัสนักศึกษาหรือชื่อ-สกุล');
        return;
    }
    try {
        showAlert('info', 'กำลังค้นหาข้อมูล...');
        showLoading(true);
        const result = await searchStudentWithCache(searchValue);
        if (result.success) {
            displayStudentData(result.data);
            updateDocumentStatus(result.data);
            document.getElementById('studentData').style.display = 'block';
            currentStudentId = result.data.studentId;
            showAlert('success', 'พบข้อมูลนักศึกษาแล้ว');
        } else {
            showAlert('error', result.message || 'ไม่พบข้อมูลนักศึกษา');
            document.getElementById('studentData').style.display = 'none';
        }
    } catch (error) {
        console.error('Error searching student:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการค้นหาข้อมูล: ' + error.message);
        showSampleData(searchValue);
    } finally {
        showLoading(false);
    }
}

function displayStudentData(studentData) {
    document.getElementById('studentId').textContent = studentData.studentId;
    document.getElementById('studentName').textContent = studentData.studentName;
    document.getElementById('educationLevel').textContent = studentData.educationLevel;
    document.getElementById('major').textContent = studentData.major;
    document.getElementById('studentClass').textContent = studentData.class || '-';
    document.getElementById('shift').textContent = studentData.shift || '-';
}

function updateDocumentStatus(studentData) {
    if (!studentData || !studentData.documents) {
        console.error('Invalid student data:', studentData);
        return;
    }
    const docs = studentData.documents;
    try {
        updateDocumentElement('studentIdCardStatus', docs.studentIdCard);
        updateDocumentElement('studentHouseRegStatus', docs.studentHouseReg);
        updateDocumentElement('fatherIdCardStatus', docs.guardianIdCard?.father);
        updateDocumentElement('fatherHouseRegStatus', docs.guardianHouseReg?.father);
        updateDocumentElement('motherIdCardStatus', docs.guardianIdCard?.mother);
        updateDocumentElement('motherHouseRegStatus', docs.guardianHouseReg?.mother);
        updateDocumentElement('otherGuardianIdCardStatus', docs.guardianIdCard?.other);
        updateDocumentElement('otherGuardianHouseRegStatus', docs.guardianHouseReg?.other);
    } catch (error) {
        console.error('Error updating document status:', error);
    }
}

function updateDocumentElement(elementId, docData) {
    if (!docData) return;
    const element = document.getElementById(elementId);
    if (!element) {
        console.warn('Element not found:', elementId);
        return;
    }
    if (docData.uploaded) {
        element.textContent = 'อัปโหลดแล้ว';
        element.className = 'status-uploaded';
    } else {
        element.textContent = 'ยังไม่ได้อัปโหลด';
        element.className = 'status-not-uploaded';
    }
}

async function loadStudentsTable(page = 1, searchQuery = '') {
    try {
        console.log('📊 Loading students table...');
        showAlert('info', 'กำลังโหลดข้อมูลนักศึกษา...');
        showLoading(true);
        
        let students = [];
        if (searchQuery) {
            const result = await pagination.loadPage(page, searchQuery);
            students = result;
        } else {
            const result = await loadAllStudentsWithCache();
            if (result && result.success) {
                students = result.data || [];
                pagination.setStudents(students);
                students = pagination.getCurrentPageStudents();
            }
        }
        
        if (students.length === 0 && page === 1 && !searchQuery) {
            students = getSampleStudents();
            showAlert('info', 'แสดงข้อมูลตัวอย่างสำหรับการทดสอบ');
        }
        
        populateStudentsTable(students);
        updateTableCount(pagination.totalItems);
        updatePaginationControls();
        updateCacheStatus();
        loadStatistics();
        
    } catch (error) {
        console.error('Error loading students:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + error.message);
        
        const tempStudents = JSON.parse(localStorage.getItem('tempStudents') || '[]');
        const sampleStudents = getSampleStudents();
        const allStudents = [...tempStudents, ...sampleStudents];
        
        pagination.setStudents(allStudents);
        const pagedStudents = pagination.getCurrentPageStudents();
        
        populateStudentsTable(pagedStudents);
        updateTableCount(allStudents.length);
        updatePaginationControls();
        showAlert('warning', 'แสดงข้อมูลจากระบบชั่วคราวและตัวอย่าง');
    } finally {
        showLoading(false);
    }
}

function populateStudentsTable(students) {
    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (!students || students.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #666; padding: 40px;">ไม่พบข้อมูลนักศึกษา</td></tr>`;
        updateTableCount(0);
        return;
    }
    
    students.forEach(student => {
        const row = document.createElement('tr');
        const docStatus = student.docs || '0/8';
        const uploadedCount = parseInt(docStatus.split('/')[0]);
        const totalCount = parseInt(docStatus.split('/')[1]);
        const isComplete = uploadedCount === totalCount;
        
        row.innerHTML = `
            <td><input type="checkbox" class="student-checkbox" value="${student.id}"></td>
            <td><strong>${student.id}</strong></td>
            <td>${student.name}</td>
            <td>${student.level}</td>
            <td>${student.major}</td>
            <td>${student.class || '-'}</td>
            <td>${student.shift || '-'}</td>
            <td><span class="doc-status ${isComplete ? 'complete' : 'incomplete'}">${docStatus}</span></td>
            <td class="action-buttons">
                <button class="btn btn-primary action-btn view-details" data-id="${student.id}" title="ดูรายละเอียด"><i class="fas fa-eye"></i></button>
                <button class="btn btn-warning action-btn edit-student" data-id="${student.id}" title="แก้ไข"><i class="fas fa-edit"></i></button>
                <button class="btn btn-danger action-btn delete-student" data-id="${student.id}" title="ลบ"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    updateTableCount(pagination.totalItems);
    
    setTimeout(() => {
        document.querySelectorAll('.view-details').forEach(btn => btn.addEventListener('click', function() { showStudentDocuments(this.dataset.id); }));
        document.querySelectorAll('.edit-student').forEach(btn => btn.addEventListener('click', function() { editStudent(this.dataset.id); }));
        document.querySelectorAll('.delete-student').forEach(btn => btn.addEventListener('click', function() { deleteStudent(this.dataset.id); }));
        document.querySelectorAll('.student-checkbox').forEach(cb => cb.addEventListener('change', updateSelectedCount));
    }, 100);
}

function updatePaginationControls() {
    const paginationContainer = document.querySelector('.pagination-container');
    if (!paginationContainer) return;
    
    const totalPages = pagination.getTotalPages();
    if (totalPages <= 1) {
        paginationContainer.style.display = 'none';
        return;
    }
    
    paginationContainer.style.display = 'block';
    
    let paginationHTML = `
        <div class="pagination">
            <button class="btn btn-outline ${!pagination.hasPreviousPage() ? 'disabled' : ''}" 
                    onclick="loadStudentsTable(${pagination.currentPage - 1}, '${pagination.searchQuery}')" 
                    ${!pagination.hasPreviousPage() ? 'disabled' : ''}>
                <i class="fas fa-chevron-left"></i> ก่อนหน้า
            </button>
            <div class="page-info">
                หน้า 
                <select class="page-select" onchange="loadStudentsTable(parseInt(this.value), '${pagination.searchQuery}')">
                    ${Array.from({length: totalPages}, (_, i) => i + 1)
                        .map(page => `<option value="${page}" ${page === pagination.currentPage ? 'selected' : ''}>${page}</option>`).join('')}
                </select> จาก ${totalPages}
            </div>
            <button class="btn btn-outline ${!pagination.hasNextPage() ? 'disabled' : ''}" 
                    onclick="loadStudentsTable(${pagination.currentPage + 1}, '${pagination.searchQuery}')" 
                    ${!pagination.hasNextPage() ? 'disabled' : ''}>
                ถัดไป <i class="fas fa-chevron-right"></i>
            </button>
        </div>
        <div class="pagination-stats"><small>แสดง ${pagination.getCurrentPageStudents().length} รายการ จากทั้งหมด ${pagination.totalItems} รายการ</small></div>
    `;
    
    paginationContainer.innerHTML = paginationHTML;
}

function updateCacheStatus() {
    const cacheStatus = document.getElementById('cacheStatus');
    if (!cacheStatus) return;
    const stats = dataCache.getStats();
    const lastSync = backgroundSync.getLastSyncTime();
    cacheStatus.innerHTML = `<i class="fas fa-database"></i> Cache: ${stats.hitRate}% Hit Rate (${stats.hits}/${stats.hits + stats.misses}) | Last Sync: ${lastSync}`;
}

async function refreshCache() {
    try {
        showAlert('info', 'กำลังอัพเดทข้อมูลล่าสุด...');
        showLoading(true);
        dataCache.clear();
        await loadAllStudentsWithCache(true);
        await loadStudentsTable(1);
        showAlert('success', 'อัพเดทข้อมูลล่าสุดเรียบร้อยแล้ว');
        updateCacheStatus();
    } catch (error) {
        console.error('Error refreshing cache:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการอัพเดทข้อมูล');
    } finally {
        showLoading(false);
    }
}

// ==================== STATISTICS FUNCTIONS ====================
async function loadStatistics() {
    try {
        const stats = await getStatisticsFromData();
        displayStatistics(stats);
        displayClassDistribution(stats);
    } catch (error) {
        console.error('Error loading statistics:', error);
    }
}

async function getStatisticsFromData() {
    try {
        const result = await callAPI(`${SCRIPT_URL}?action=getStatistics`);
        if (result && result.success) return result.data;
    } catch (error) {
        console.log('Using client-side statistics');
    }
    
    const students = pagination.allStudents;
    const stats = {
        totalStudents: students.length,
        levels: {},
        shifts: { 'เช้า': 0, 'บ่าย': 0 },
        majors: {},
        documentUploadCount: 0,
        studentsWithCompleteDocs: 0
    };
    
    students.forEach(s => {
        stats.levels[s.level] = (stats.levels[s.level] || 0) + 1;
        stats.shifts[s.shift] = (stats.shifts[s.shift] || 0) + 1;
        stats.majors[s.major] = (stats.majors[s.major] || 0) + 1;
        
        const uploaded = parseInt(s.docs.split('/')[0]);
        stats.documentUploadCount += uploaded;
        if (uploaded === 8) stats.studentsWithCompleteDocs++;
    });
    
    return stats;
}

function displayStatistics(stats) {
    const statCards = document.getElementById('statCards');
    if (!statCards) return;
    
    const docCompletionRate = stats.totalStudents > 0 
        ? ((stats.studentsWithCompleteDocs / stats.totalStudents) * 100).toFixed(1) 
        : 0;
    
    statCards.innerHTML = `
        <div class="stat-card">
            <div class="stat-icon"><i class="fas fa-users"></i></div>
            <div class="stat-value">${stats.totalStudents}</div>
            <div class="stat-label">นักเรียนทั้งหมด</div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #3498db, #2980b9);">
            <div class="stat-icon"><i class="fas fa-graduation-cap"></i></div>
            <div class="stat-value">${Object.keys(stats.levels).length}</div>
            <div class="stat-label">ระดับการศึกษา</div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #2ecc71, #27ae60);">
            <div class="stat-icon"><i class="fas fa-check-circle"></i></div>
            <div class="stat-value">${stats.studentsWithCompleteDocs}</div>
            <div class="stat-label">เอกสารครบถ้วน</div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #f39c12, #e67e22);">
            <div class="stat-icon"><i class="fas fa-chart-line"></i></div>
            <div class="stat-value">${docCompletionRate}%</div>
            <div class="stat-label">อัตราความครบถ้วน</div>
        </div>
    `;
}

function displayClassDistribution(stats) {
    const classDistDiv = document.getElementById('classDistribution');
    const classCard = document.getElementById('classDistributionCard');
    if (!classDistDiv || !classCard) return;
    
    const levelCounts = stats.levels;
    const levelEntries = Object.entries(levelCounts).sort((a, b) => a[0].localeCompare(b[0]));
    
    if (levelEntries.length === 0) {
        classCard.style.display = 'none';
        return;
    }
    
    classCard.style.display = 'block';
    
    let html = '';
    levelEntries.forEach(([level, count]) => {
        const percentage = ((count / stats.totalStudents) * 100).toFixed(1);
        html += `
            <div class="class-item">
                <div class="class-name">${level}</div>
                <div class="class-count">${count}</div>
                <div class="progress-bar"><div class="progress-fill" style="width: ${percentage}%;"></div></div>
                <div style="font-size: 0.8rem; color: #666; margin-top: 5px;">${percentage}%</div>
            </div>
        `;
    });
    
    classDistDiv.innerHTML = html;
}

// ==================== ADMIN FUNCTIONS ====================
async function adminLogin() {
    const username = document.getElementById('adminUsername').value;
    const password = document.getElementById('adminPassword').value;
    
    if (!username || !password) {
        showAlert('error', 'กรุณาป้อนชื่อผู้ใช้และรหัสผ่าน');
        return;
    }
    
    try {
        showAlert('info', 'กำลังเข้าสู่ระบบ...');
        showLoading(true);
        
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'adminLogin', username: username, password: password })
        });
        
        if (result.success) {
            isAdminLoggedIn = true;
            localStorage.setItem('adminLoggedIn', 'true');
            localStorage.setItem('adminUsername', username);
            localStorage.setItem('adminToken', result.data.token);
            
            document.getElementById('adminLoginForm').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'block';
            
            await loadStudentsTable();
            await loadStatistics();
            
            showAlert('success', 'เข้าสู่ระบบสำเร็จ');
        } else {
            showAlert('error', result.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        }
    } catch (error) {
        console.error('Error during login:', error);
        if (username === 'admin' && password === 'admin452026') {
            isAdminLoggedIn = true;
            localStorage.setItem('adminLoggedIn', 'true');
            localStorage.setItem('adminUsername', username);
            
            document.getElementById('adminLoginForm').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'block';
            loadStudentsTable();
            loadStatistics();
            showAlert('warning', 'เข้าสู่ระบบในโหมดออฟไลน์ (API ไม่สามารถเชื่อมต่อได้)');
        } else {
            showAlert('error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        }
    } finally {
        showLoading(false);
    }
}

function setupFallbackLogin() {
    const savedLogin = localStorage.getItem('adminLoggedIn');
    const savedUsername = localStorage.getItem('adminUsername');
    if (savedLogin === 'true' && savedUsername) {
        isAdminLoggedIn = true;
        document.getElementById('adminLoginForm').style.display = 'none';
        document.getElementById('adminPanel').style.display = 'block';
        loadStudentsTable();
        loadStatistics();
        console.log('🔐 Restored admin session for:', savedUsername);
    }
}

function adminLogout() {
    if (confirm('คุณแน่ใจว่าต้องการออกจากระบบ?')) {
        isAdminLoggedIn = false;
        localStorage.removeItem('adminLoggedIn');
        localStorage.removeItem('adminUsername');
        localStorage.removeItem('adminToken');
        document.getElementById('adminLoginForm').style.display = 'block';
        document.getElementById('adminPanel').style.display = 'none';
        document.getElementById('reportSection').style.display = 'none';
        document.getElementById('adminUsername').value = '';
        document.getElementById('adminPassword').value = '';
        showAlert('success', 'ออกจากระบบสำเร็จ');
    }
}

async function adminSearch() {
    const searchValue = document.getElementById('adminSearchInput').value.trim();
    if (!searchValue) {
        await loadStudentsTable(1);
        return;
    }
    
    try {
        showAlert('info', 'กำลังค้นหา...');
        showLoading(true);
        const result = await pagination.loadPage(1, searchValue);
        populateStudentsTable(result);
        updateTableCount(pagination.totalItems);
        updatePaginationControls();
        updateCacheStatus();
        showAlert('success', `พบ ${pagination.totalItems} รายการ`);
    } catch (error) {
        console.error('Error searching students:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการค้นหา: ' + error.message);
        showSampleStudentsTable(searchValue);
    } finally {
        showLoading(false);
    }
}

// ==================== DOCUMENT MANAGEMENT ====================
async function showStudentDocuments(studentId) {
    try {
        showAlert('info', 'กำลังโหลดรายละเอียดเอกสาร...');
        showLoading(true);
        
        const result = await callAPI(`${SCRIPT_URL}?action=searchStudent&query=${studentId}`);
        
        if (result.success) {
            currentStudentId = studentId;
            showDocumentDetailsModal(result.data);
            showAlert('success', 'โหลดรายละเอียดเอกสารสำเร็จ');
        } else {
            showAlert('error', result.message || 'ไม่สามารถโหลดข้อมูลได้');
        }
    } catch (error) {
        console.error('Error loading student documents:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function showDocumentDetailsModal(studentData) {
    const existingModal = document.getElementById('documentDetailsModal');
    if (existingModal) existingModal.remove();
    
    const modalHTML = `
        <div class="modal" id="documentDetailsModal" style="display: flex;">
            <div class="modal-content" style="max-width: 900px;">
                <div class="modal-header">
                    <h3 class="modal-title"><i class="fas fa-file-alt"></i> รายละเอียดเอกสาร - ${studentData.studentName}</h3>
                    <button class="close-btn" onclick="closeDocumentDetailsModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="student-info">
                        <div class="info-group"><div class="info-label"><i class="fas fa-id-card"></i> รหัสนักศึกษา</div><div class="info-value">${studentData.studentId}</div></div>
                        <div class="info-group"><div class="info-label"><i class="fas fa-user"></i> ชื่อ-สกุล</div><div class="info-value">${studentData.studentName}</div></div>
                    </div>
                    <div class="document-section">
                        <h3><i class="fas fa-folder-open"></i> เอกสารประกอบ <small class="doc-count">(ทั้งหมด 8 เอกสาร)</small></h3>
                        ${generateDocumentGrid(studentData)}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-info btn-block" onclick="printStudentDocuments('${studentData.studentId}')"><i class="fas fa-print"></i> พิมพ์เอกสารทั้งหมด</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function generateDocumentGrid(studentData) {
    return `
        <div class="section-divider"><h4><i class="fas fa-user-graduate"></i> เอกสารนักศึกษา</h4></div>
        <div class="document-grid">
            ${generateDocumentCard('studentIdCard', 'สำเนาบัตรประชาชนนักศึกษา', 'fa-id-card', studentData)}
            ${generateDocumentCard('studentHouseReg', 'สำเนาทะเบียนบ้านนักศึกษา', 'fa-home', studentData)}
        </div>
        <div class="section-divider"><h4><i class="fas fa-users"></i> เอกสารผู้ปกครอง (พ่อ)</h4></div>
        <div class="document-grid">
            ${generateGuardianCard('guardianIdCard', 'father', 'สำเนาบัตรประชาชนพ่อ', 'fa-male', studentData)}
            ${generateGuardianCard('guardianHouseReg', 'father', 'สำเนาทะเบียนบ้านพ่อ', 'fa-house-user', studentData)}
        </div>
        <div class="section-divider"><h4><i class="fas fa-users"></i> เอกสารผู้ปกครอง (แม่)</h4></div>
        <div class="document-grid">
            ${generateGuardianCard('guardianIdCard', 'mother', 'สำเนาบัตรประชาชนแม่', 'fa-female', studentData)}
            ${generateGuardianCard('guardianHouseReg', 'mother', 'สำเนาทะเบียนบ้านแม่', 'fa-house-user', studentData)}
        </div>
        <div class="section-divider"><h4><i class="fas fa-user-tie"></i> เอกสารผู้ปกครองอื่น</h4></div>
        <div class="document-grid">
            ${generateGuardianCard('guardianIdCard', 'other', 'สำเนาบัตรประชาชนผู้ปกครองอื่น', 'fa-user-tie', studentData)}
            ${generateGuardianCard('guardianHouseReg', 'other', 'สำเนาทะเบียนบ้านผู้ปกครองอื่น', 'fa-house-user', studentData)}
        </div>
    `;
}

function generateDocumentCard(docType, title, icon, studentData) {
    const doc = studentData.documents[docType];
    const isUploaded = doc && doc.uploaded;
    return `
        <div class="document-card">
            <div class="document-header"><i class="fas ${icon}"></i><h4>${title}</h4></div>
            <div class="document-body"><p class="${isUploaded ? 'status-uploaded' : 'status-not-uploaded'}">
                <i class="fas ${isUploaded ? 'fa-check-circle' : 'fa-times-circle'}"></i> ${isUploaded ? 'อัปโหลดแล้ว' : 'ยังไม่ได้อัปโหลด'}
            </p></div>
            <div class="document-actions">
                <button class="btn btn-primary action-btn view-doc" onclick="viewDocumentInModal('${docType}')"><i class="fas fa-eye"></i> ดู</button>
                <button class="btn btn-success action-btn upload-doc" onclick="uploadDocumentInModal('${docType}')"><i class="fas fa-upload"></i> อัปโหลด</button>
            </div>
        </div>
    `;
}

function generateGuardianCard(docType, guardianType, title, icon, studentData) {
    const doc = studentData.documents[docType] && studentData.documents[docType][guardianType];
    const isUploaded = doc && doc.uploaded;
    return `
        <div class="document-card">
            <div class="document-header"><i class="fas ${icon}"></i><h4>${title}</h4></div>
            <div class="document-body"><p class="${isUploaded ? 'status-uploaded' : 'status-not-uploaded'}">
                <i class="fas ${isUploaded ? 'fa-check-circle' : 'fa-times-circle'}"></i> ${isUploaded ? 'อัปโหลดแล้ว' : 'ยังไม่ได้อัปโหลด'}
            </p></div>
            <div class="document-actions">
                <button class="btn btn-primary action-btn view-doc" onclick="viewDocumentInModal('${docType}', '${guardianType}')"><i class="fas fa-eye"></i> ดู</button>
                <button class="btn btn-success action-btn upload-doc" onclick="uploadDocumentInModal('${docType}', '${guardianType}')"><i class="fas fa-upload"></i> อัปโหลด</button>
            </div>
        </div>
    `;
}

function closeDocumentDetailsModal() {
    const modal = document.getElementById('documentDetailsModal');
    if (modal) modal.remove();
}

function viewDocumentInModal(docType, guardianType = null) {
    viewDocument(docType, guardianType);
}

function uploadDocumentInModal(docType, guardianType = null) {
    openUploadModal(docType, guardianType);
}

function openUploadModal(docType, guardianType = null) {
    if (!currentStudentId) {
        showAlert('error', 'กรุณาค้นหาข้อมูลนักศึกษาก่อน');
        return;
    }
    
    currentDocumentType = docType;
    currentGuardianType = guardianType;
    
    document.getElementById('uploadModalTitle').textContent = 'อัปโหลดเอกสาร - ' + getDocumentTypeName(docType, guardianType);
    document.getElementById('documentType').value = docType;
    
    const guardianTypeGroup = document.getElementById('guardianTypeGroup');
    if (docType === 'guardianIdCard' || docType === 'guardianHouseReg') {
        guardianTypeGroup.style.display = 'block';
        if (guardianType) document.getElementById('modalGuardianType').value = guardianType;
    } else {
        guardianTypeGroup.style.display = 'none';
    }
    
    document.getElementById('fileInput').value = '';
    document.getElementById('filePreview').style.display = 'none';
    selectedFile = null;
    
    document.getElementById('uploadModal').style.display = 'flex';
}

function getDocumentTypeName(docType, guardianType = null) {
    const names = {
        'studentIdCard': 'สำเนาบัตรประชาชนนักศึกษา',
        'studentHouseReg': 'สำเนาทะเบียนบ้านนักศึกษา',
        'guardianIdCard': 'สำเนาบัตรประชาชนผู้ปกครอง',
        'guardianHouseReg': 'สำเนาทะเบียนบ้านผู้ปกครอง'
    };
    let name = names[docType] || docType;
    if (guardianType) {
        const guardianNames = { 'father': 'พ่อ', 'mother': 'แม่', 'other': 'ผู้ปกครองอื่นๆ' };
        name += ' (' + (guardianNames[guardianType] || guardianType) + ')';
    }
    return name;
}

function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const fileType = file.type;
    const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    const isValidType = fileType === 'application/pdf' || validImageTypes.includes(fileType);
    
    if (!isValidType) {
        showAlert('error', 'กรุณาเลือกไฟล์ PDF หรือรูปภาพ (JPG, PNG) เท่านั้น');
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        showAlert('error', 'ขนาดไฟล์ต้องไม่เกิน 5MB');
        return;
    }
    
    selectedFile = file;
    document.getElementById('fileName').textContent = `${file.name} (${formatFileSize(file.size)})`;
    document.getElementById('filePreview').style.display = 'block';
    showAlert('success', 'เลือกไฟล์สำเร็จ: ' + file.name);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function confirmUpload() {
    if (!selectedFile) {
        showAlert('error', 'กรุณาเลือกไฟล์ก่อนอัปโหลด');
        return;
    }
    
    if (!currentStudentId) {
        showAlert('error', 'ไม่พบรหัสนักศึกษา');
        return;
    }
    
    try {
        showAlert('info', 'กำลังอัปโหลดเอกสาร...');
        showLoading(true);
        
        const base64Data = await fileToBase64(selectedFile);
        
        const requestData = {
            action: 'uploadDocument',
            studentId: currentStudentId,
            documentType: currentDocumentType,
            filename: selectedFile.name,
            fileData: base64Data,
            contentType: selectedFile.type
        };
        
        if (currentDocumentType === 'guardianIdCard' || currentDocumentType === 'guardianHouseReg') {
            requestData.guardianType = document.getElementById('modalGuardianType').value;
        }
        
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });
        
        if (result.success) {
            closeUploadModal();
            showUploadSuccess(currentDocumentType, requestData.guardianType);
            updateDocumentStatusAfterUpload(currentDocumentType, requestData.guardianType);
            
            if (currentMode === 'admin') {
                await loadStudentsTable();
                const detailsModal = document.getElementById('documentDetailsModal');
                if (detailsModal) {
                    closeDocumentDetailsModal();
                    setTimeout(() => showStudentDocuments(currentStudentId), 500);
                }
            }
        } else {
            showAlert('error', result.message || 'เกิดข้อผิดพลาดในการอัปโหลด');
        }
    } catch (error) {
        console.error('Error uploading document:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการอัปโหลด: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
    });
}

function updateDocumentStatusAfterUpload(docType, guardianType = null) {
    const statusMap = {
        'studentIdCard': 'studentIdCardStatus',
        'studentHouseReg': 'studentHouseRegStatus',
        'guardianIdCard_father': 'fatherIdCardStatus',
        'guardianHouseReg_father': 'fatherHouseRegStatus',
        'guardianIdCard_mother': 'motherIdCardStatus',
        'guardianHouseReg_mother': 'motherHouseRegStatus',
        'guardianIdCard_other': 'otherGuardianIdCardStatus',
        'guardianHouseReg_other': 'otherGuardianHouseRegStatus'
    };
    const statusKey = guardianType ? `${docType}_${guardianType}` : docType;
    const elementId = statusMap[statusKey];
    if (elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = 'อัปโหลดแล้ว';
            element.className = 'status-uploaded';
        }
    }
}

function showUploadSuccess(documentType, guardianType = null) {
    const docName = getDocumentTypeName(documentType, guardianType);
    showAlert('success', `อัปโหลดเอกสาร "${docName}" สำเร็จเรียบร้อยแล้ว`, 5000);
    updateDocumentStatusAfterUpload(documentType, guardianType);
    
    const statusMap = {
        'studentIdCard': 'studentIdCardStatus',
        'studentHouseReg': 'studentHouseRegStatus',
        'guardianIdCard_father': 'fatherIdCardStatus',
        'guardianHouseReg_father': 'fatherHouseRegStatus',
        'guardianIdCard_mother': 'motherIdCardStatus',
        'guardianHouseReg_mother': 'motherHouseRegStatus',
        'guardianIdCard_other': 'otherGuardianIdCardStatus',
        'guardianHouseReg_other': 'otherGuardianHouseRegStatus'
    };
    const statusKey = guardianType ? `${documentType}_${guardianType}` : documentType;
    const elementId = statusMap[statusKey];
    if (elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.style.transform = 'scale(1.05)';
            element.style.transition = 'all 0.3s ease';
            setTimeout(() => element.style.transform = 'scale(1)', 300);
        }
    }
}

async function viewDocument(docType, guardianType = null) {
    if (!currentStudentId) {
        showAlert('error', 'กรุณาค้นหาข้อมูลนักศึกษาก่อน');
        return;
    }
    
    try {
        showAlert('info', 'กำลังโหลดเอกสาร...');
        showLoading(true);
        
        let url = `${SCRIPT_URL}?action=getDocument&studentId=${currentStudentId}&documentType=${docType}`;
        if (guardianType) url += `&guardianType=${guardianType}`;
        
        const result = await callAPI(url);
        
        if (result.success && result.data.fileUrl) {
            showDocumentViewer(result.data);
        } else {
            showAlert('error', result.message || 'ไม่พบเอกสารหรือยังไม่ได้อัปโหลด');
        }
    } catch (error) {
        console.error('Error viewing document:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการเปิดเอกสาร: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function showDocumentViewer(docData) {
    const modal = document.getElementById('documentViewModal');
    const viewer = document.getElementById('documentViewer');
    const downloadLink = document.getElementById('downloadDocumentLink');
    const notFound = document.getElementById('documentNotFound');
    const deleteBtn = document.getElementById('deleteDocumentBtn');
    
    if (docData.fileUrl.includes('.pdf')) {
        viewer.src = docData.fileUrl;
        viewer.style.display = 'block';
        notFound.style.display = 'none';
    } else {
        viewer.src = '';
        viewer.style.display = 'none';
        notFound.style.display = 'block';
    }
    
    downloadLink.href = docData.fileUrl;
    
    deleteBtn.onclick = () => {
        if (confirm('คุณแน่ใจว่าต้องการลบเอกสารนี้?')) {
            deleteCurrentDocument();
        }
    };
    
    modal.style.display = 'flex';
}

async function deleteCurrentDocument() {
    if (!currentStudentId || !currentDocumentType) return;
    
    try {
        showAlert('info', 'กำลังลบเอกสาร...');
        showLoading(true);
        
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'deleteDocument',
                studentId: currentStudentId,
                documentType: currentDocumentType,
                guardianType: currentGuardianType
            })
        });
        
        if (result.success) {
            closeDocumentViewModal();
            updateDocumentStatusAfterUpload(currentDocumentType, currentGuardianType);
            showAlert('success', 'ลบเอกสารสำเร็จ');
            await loadStudentsTable();
        } else {
            showAlert('error', result.message || 'เกิดข้อผิดพลาดในการลบเอกสาร');
        }
    } catch (error) {
        console.error('Error deleting document:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการลบเอกสาร: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function closeDocumentViewModal() {
    document.getElementById('documentViewModal').style.display = 'none';
    document.getElementById('documentViewer').src = '';
}

// ==================== STUDENT MANAGEMENT ====================
function openAddStudentModal() {
    document.getElementById('studentModalTitle').textContent = 'เพิ่มนักศึกษา';
    document.getElementById('modalStudentId').value = '';
    document.getElementById('modalStudentName').value = '';
    document.getElementById('modalEducationLevel').value = 'ปวช.1';
    document.getElementById('modalMajor').value = '';
    document.getElementById('modalClass').value = '';
    document.getElementById('modalShift').value = 'เช้า';
    document.getElementById('modalStudentId').disabled = false;
    document.getElementById('studentModal').style.display = 'flex';
}

function closeStudentModal() {
    document.getElementById('studentModal').style.display = 'none';
}

async function saveStudent() {
    const studentId = document.getElementById('modalStudentId').value.trim();
    const studentName = document.getElementById('modalStudentName').value.trim();
    const educationLevel = document.getElementById('modalEducationLevel').value;
    const major = document.getElementById('modalMajor').value.trim();
    const studentClass = document.getElementById('modalClass').value.trim();
    const shift = document.getElementById('modalShift').value;
    
    if (!studentId || !studentName || !educationLevel || !major) {
        showAlert('error', 'กรุณากรอกข้อมูลให้ครบถ้วน');
        return;
    }
    
    try {
        showAlert('info', 'กำลังบันทึกข้อมูลนักศึกษา...');
        showLoading(true);
        
        const requestData = {
            action: 'addStudent',
            studentId: studentId,
            studentName: studentName,
            educationLevel: educationLevel,
            major: major,
            class: studentClass,
            shift: shift
        };
        
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });
        
        if (result.success) {
            closeStudentModal();
            showAlert('success', result.message || 'เพิ่มนักศึกษาเรียบร้อยแล้ว');
            dataCache.delete('all_students');
            if (currentMode === 'admin') await loadStudentsTable();
            
            document.getElementById('modalStudentId').value = '';
            document.getElementById('modalStudentName').value = '';
            document.getElementById('modalEducationLevel').value = 'ปวช.1';
            document.getElementById('modalMajor').value = '';
            document.getElementById('modalClass').value = '';
            document.getElementById('modalShift').value = 'เช้า';
        } else {
            showAlert('error', result.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        }
    } catch (error) {
        console.error('❌ Error saving student:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + error.message);
        saveStudentToLocalStorage(studentId, studentName, educationLevel, major, studentClass, shift);
    } finally {
        showLoading(false);
    }
}

function saveStudentToLocalStorage(studentId, studentName, educationLevel, major, studentClass, shift) {
    try {
        const studentData = {
            id: studentId,
            name: studentName,
            level: educationLevel,
            major: major,
            class: studentClass,
            shift: shift,
            docs: '0/8',
            timestamp: new Date().toISOString()
        };
        
        const existingData = JSON.parse(localStorage.getItem('tempStudents') || '[]');
        const isDuplicate = existingData.some(s => s.id === studentId);
        if (isDuplicate) {
            showAlert('error', 'รหัสนักศึกษานี้มีอยู่ในระบบแล้ว (ข้อมูลชั่วคราว)');
            return;
        }
        
        existingData.push(studentData);
        localStorage.setItem('tempStudents', JSON.stringify(existingData));
        
        closeStudentModal();
        showAlert('warning', 'บันทึกข้อมูลชั่วคราวในเบราว์เซอร์ (API ไม่สามารถเชื่อมต่อได้)');
        if (currentMode === 'admin') loadStudentsTable();
    } catch (error) {
        console.error('Error saving to localStorage:', error);
        showAlert('error', 'ไม่สามารถบันทึกข้อมูลได้');
    }
}

async function editStudent(studentId) {
    try {
        showAlert('info', 'กำลังโหลดข้อมูล...');
        showLoading(true);
        
        const result = await callAPI(`${SCRIPT_URL}?action=getStudent&studentId=${studentId}`);
        
        if (result.success) {
            const student = result.data;
            document.getElementById('studentModalTitle').textContent = 'แก้ไขข้อมูลนักศึกษา';
            document.getElementById('modalStudentId').value = student.id;
            document.getElementById('modalStudentName').value = student.name;
            document.getElementById('modalEducationLevel').value = student.level;
            document.getElementById('modalMajor').value = student.major;
            document.getElementById('modalClass').value = student.class || '';
            document.getElementById('modalShift').value = student.shift || 'เช้า';
            document.getElementById('modalStudentId').disabled = true;
            document.getElementById('studentModal').style.display = 'flex';
        } else {
            showAlert('error', result.message || 'ไม่พบข้อมูลนักศึกษา');
        }
    } catch (error) {
        console.error('Error loading student for edit:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + error.message);
    } finally {
        showLoading(false);
    }
}

async function deleteStudent(studentId) {
    if (!confirm(`คุณแน่ใจว่าต้องการลบข้อมูลนักศึกษารหัส ${studentId} ใช่หรือไม่?\nการลบจะไม่สามารถกู้คืนได้!`)) {
        return;
    }
    
    try {
        showAlert('info', 'กำลังลบข้อมูล...');
        showLoading(true);
        
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'deleteStudent', studentId: studentId })
        });
        
        if (result.success) {
            showAlert('success', 'ลบข้อมูลนักศึกษาสำเร็จ');
            dataCache.delete('all_students');
            await loadStudentsTable();
            await loadStatistics();
        } else {
            showAlert('error', result.message || 'เกิดข้อผิดพลาดในการลบข้อมูล');
        }
    } catch (error) {
        console.error('Error deleting student:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการลบข้อมูล: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// ==================== IMPORT/EXPORT FUNCTIONS ====================
function openImportModal() {
    document.getElementById('importModal').style.display = 'flex';
    document.getElementById('excelPreview').style.display = 'none';
    document.getElementById('excelFileInput').value = '';
}

function closeImportModal() {
    document.getElementById('importModal').style.display = 'none';
}

async function handleExcelFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
        showAlert('info', 'กำลังอ่านไฟล์ Excel...');
        showLoading(true);
        
        const data = await readExcelFile(file);
        displayExcelPreview(data);
        
        window.excelData = data;
    } catch (error) {
        console.error('Error reading Excel:', error);
        showAlert('error', 'ไม่สามารถอ่านไฟล์ Excel ได้: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                
                const students = jsonData.map(row => ({
                    id: row['id']?.toString() || '',
                    name: row['name'] || '',
                    level: row['level'] || '',
                    major: row['major'] || '',
                    shift: row['round'] || row['shift'] || '',
                    class: row['class'] || ''
                })).filter(s => s.id && s.name);
                
                resolve(students);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

function displayExcelPreview(students) {
    const previewDiv = document.getElementById('excelPreview');
    const table = document.getElementById('excelPreviewTable');
    
    if (!students || students.length === 0) {
        showAlert('error', 'ไม่พบข้อมูลในไฟล์ Excel');
        return;
    }
    
    let html = '<thead><tr><th>รหัส</th><th>ชื่อ</th><th>ระดับ</th><th>สาขา</th><th>รอบ</th><th>ชั้นเรียน</th></tr></thead><tbody>';
    const previewData = students.slice(0, 5);
    
    previewData.forEach(s => {
        html += `<tr><td>${s.id}</td><td>${s.name}</td><td>${s.level}</td><td>${s.major}</td><td>${s.shift}</td><td>${s.class}</td></tr>`;
    });
    
    if (students.length > 5) {
        html += `<tr><td colspan="6" style="text-align: center;">และอื่นๆ อีก ${students.length - 5} รายการ</td></tr>`;
    }
    
    html += '</tbody>';
    table.innerHTML = html;
    previewDiv.style.display = 'block';
}

async function confirmImport() {
    if (!window.excelData || window.excelData.length === 0) {
        showAlert('error', 'กรุณาเลือกไฟล์ Excel ก่อน');
        return;
    }
    
    try {
        showAlert('info', `กำลังนำเข้าข้อมูล ${window.excelData.length} รายการ...`);
        showLoading(true);
        
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'importStudentsFromExcel',
                students: window.excelData
            })
        });
        
        if (result.success) {
            closeImportModal();
            showAlert('success', result.message);
            dataCache.clear();
            await loadStudentsTable();
            await loadStatistics();
            window.excelData = null;
        } else {
            showAlert('error', result.message || 'เกิดข้อผิดพลาดในการนำเข้าข้อมูล');
        }
    } catch (error) {
        console.error('Error importing data:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการนำเข้าข้อมูล: ' + error.message);
    } finally {
        showLoading(false);
    }
}

async function importSampleData() {
    try {
        showAlert('info', 'กำลังนำเข้าข้อมูลตัวอย่าง...');
        showLoading(true);
        
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'importSampleData' })
        });
        
        if (result.success) {
            showAlert('success', result.message);
            dataCache.clear();
            await loadStudentsTable();
            await loadStatistics();
        } else {
            showAlert('error', result.message || 'เกิดข้อผิดพลาดในการนำเข้าข้อมูลตัวอย่าง');
        }
    } catch (error) {
        console.error('Error importing sample data:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการนำเข้าข้อมูลตัวอย่าง: ' + error.message);
    } finally {
        showLoading(false);
    }
}

async function exportToJSON() {
    try {
        showAlert('info', 'กำลังส่งออกข้อมูล...');
        const result = await callAPI(`${SCRIPT_URL}?action=exportData&format=json`);
        
        if (result.success) {
            const dataStr = JSON.stringify(result.data, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
            const exportName = `students_${new Date().toISOString().slice(0,10)}.json`;
            
            const link = document.createElement('a');
            link.setAttribute('href', dataUri);
            link.setAttribute('download', exportName);
            link.click();
            
            showAlert('success', 'ส่งออกข้อมูลสำเร็จ');
        } else {
            showAlert('error', result.message || 'เกิดข้อผิดพลาดในการส่งออกข้อมูล');
        }
    } catch (error) {
        console.error('Error exporting data:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการส่งออกข้อมูล: ' + error.message);
    }
}

function exportToExcel() {
    window.open('https://docs.google.com/spreadsheets/d/1kt0l2eKCbKvYvtLtnhDAleolzpxFB4fos6ZNQ87bDB0/export?format=xlsx', '_blank');
    showAlert('info', 'กำลังส่งออกข้อมูล Excel...');
}

// ==================== REPORT FUNCTIONS ====================
async function generateReport() {
    try {
        showAlert('info', 'กำลังสร้างรายงาน...');
        showLoading(true);
        
        const result = await callAPI(`${SCRIPT_URL}?action=generateReport`);
        
        if (result.success) {
            displayReport(result.data);
            showAlert('success', 'สร้างรายงานสำเร็จ');
        } else {
            showAlert('error', result.message || 'เกิดข้อผิดพลาดในการสร้างรายงาน');
        }
    } catch (error) {
        console.error('Error generating report:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการสร้างรายงาน: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function displayReport(reportData) {
    const reportContent = document.getElementById('reportContent');
    const reportSection = document.getElementById('reportSection');
    
    if (!reportContent || !reportSection) {
        showAlert('error', 'ไม่พบส่วนแสดงรายงาน');
        return;
    }
    
    const totalStudents = reportData.totalStudents;
    const idCardPercent = totalStudents > 0 ? ((reportData.documentStats.totalWithIdCard / totalStudents) * 100).toFixed(1) : 0;
    const houseRegPercent = totalStudents > 0 ? ((reportData.documentStats.totalWithHouseReg / totalStudents) * 100).toFixed(1) : 0;
    const completePercent = totalStudents > 0 ? ((reportData.documentStats.completeDocuments / totalStudents) * 100).toFixed(1) : 0;
    
    let levelHtml = '';
    for (const [level, count] of Object.entries(reportData.byLevel)) {
        levelHtml += `<div class="detail-item"><span class="detail-label">${level}:</span><span class="detail-value">${count} คน (${((count/totalStudents)*100).toFixed(1)}%)</span></div>`;
    }
    
    let majorHtml = '';
    for (const [major, count] of Object.entries(reportData.byMajor)) {
        majorHtml += `<div class="detail-item"><span class="detail-label">${major}:</span><span class="detail-value">${count} คน</span></div>`;
    }
    
    let classHtml = '';
    const classEntries = Object.entries(reportData.classDistribution).sort().slice(0, 10);
    for (const [className, count] of classEntries) {
        classHtml += `<div class="detail-item"><span class="detail-label">${className}:</span><span class="detail-value">${count} คน</span></div>`;
    }
    
    let html = `
        <div class="report-grid">
            <div class="report-card"><h3><i class="fas fa-users"></i> จำนวนนักเรียนทั้งหมด</h3><div class="report-value">${totalStudents}</div></div>
            <div class="report-card"><h3><i class="fas fa-id-card"></i> มีบัตรประชาชน</h3><div class="report-value">${reportData.documentStats.totalWithIdCard}</div><div class="report-percentage">${idCardPercent}%</div></div>
            <div class="report-card"><h3><i class="fas fa-home"></i> มีทะเบียนบ้าน</h3><div class="report-value">${reportData.documentStats.totalWithHouseReg}</div><div class="report-percentage">${houseRegPercent}%</div></div>
            <div class="report-card"><h3><i class="fas fa-check-circle"></i> เอกสารครบถ้วน</h3><div class="report-value">${reportData.documentStats.completeDocuments}</div><div class="report-percentage">${completePercent}%</div></div>
        </div>
        <div class="report-details">
            <div class="detail-section"><h4><i class="fas fa-graduation-cap"></i> จำแนกตามระดับการศึกษา</h4><div class="detail-grid">${levelHtml}</div></div>
            <div class="detail-section"><h4><i class="fas fa-book"></i> จำแนกตามสาขาวิชา</h4><div class="detail-grid">${majorHtml}</div></div>
            <div class="detail-section"><h4><i class="fas fa-users"></i> ชั้นเรียนยอดนิยม</h4><div class="detail-grid">${classHtml}</div></div>
        </div>
    `;
    
    reportContent.innerHTML = html;
    reportSection.style.display = 'block';
    reportSection.scrollIntoView({ behavior: 'smooth' });
}

// ==================== BATCH OPERATIONS ====================
function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('.student-checkbox:checked');
    const count = checkboxes.length;
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    
    if (count > 0) {
        bulkDeleteBtn.style.display = 'inline-flex';
        document.getElementById('selectedCount').textContent = count;
    } else {
        bulkDeleteBtn.style.display = 'none';
    }
}

function selectAllStudents() {
    const checkboxes = document.querySelectorAll('.student-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    
    checkboxes.forEach(cb => cb.checked = !allChecked);
    updateSelectedCount();
}

function clearSelection() {
    document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = false);
    updateSelectedCount();
}

async function bulkDeleteStudents() {
    const selectedIds = Array.from(document.querySelectorAll('.student-checkbox:checked')).map(cb => cb.value);
    
    if (selectedIds.length === 0) {
        showAlert('error', 'กรุณาเลือกนักศึกษาที่ต้องการลบ');
        return;
    }
    
    if (!confirm(`คุณแน่ใจว่าต้องการลบข้อมูล ${selectedIds.length} รายการ ใช่หรือไม่?\nการลบจะไม่สามารถกู้คืนได้!`)) {
        return;
    }
    
    try {
        showAlert('info', `กำลังลบข้อมูล ${selectedIds.length} รายการ...`);
        showLoading(true);
        
        const result = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'bulkDeleteStudents',
                studentIds: selectedIds
            })
        });
        
        if (result.success) {
            showAlert('success', result.message);
            dataCache.clear();
            await loadStudentsTable();
            await loadStatistics();
            document.getElementById('bulkDeleteBtn').style.display = 'none';
        } else {
            showAlert('error', result.message || 'เกิดข้อผิดพลาดในการลบข้อมูล');
        }
    } catch (error) {
        console.error('Error bulk deleting students:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการลบข้อมูล: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// ==================== FILTER FUNCTIONS ====================
function applyFilters() {
    const level = document.getElementById('filterLevel').value;
    const major = document.getElementById('filterMajor').value;
    const shift = document.getElementById('filterShift').value;
    const docStatus = document.getElementById('filterDocStatus').value;
    
    const allStudents = pagination.allStudents;
    
    let filtered = allStudents.filter(student => {
        if (level && student.level !== level) return false;
        if (major && student.major !== major) return false;
        if (shift && student.shift !== shift) return false;
        
        if (docStatus) {
            const uploaded = parseInt(student.docs.split('/')[0]);
            if (docStatus === 'complete' && uploaded !== 8) return false;
            if (docStatus === 'incomplete' && uploaded === 8) return false;
        }
        
        return true;
    });
    
    pagination.setStudents(filtered);
    pagination.currentPage = 1;
    populateStudentsTable(pagination.getCurrentPageStudents());
    updateTableCount(filtered.length);
    updatePaginationControls();
    
    showAlert('success', `พบข้อมูล ${filtered.length} รายการ ตามเงื่อนไขที่เลือก`);
}

// ==================== SYSTEM FUNCTIONS ====================
async function testConnection() {
    try {
        console.log('🔗 Testing API connection...');
        const testUrl = `${SCRIPT_URL}?action=test&_=${Date.now()}`;
        
        try {
            const response = await fetch(testUrl, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            if (response.ok) {
                const data = await response.json();
                return data.success === true;
            }
        } catch (simpleError) {
            console.log('Simple test failed:', simpleError);
        }
        
        try {
            const proxyTest = await callAPIViaProxy(`${SCRIPT_URL}?action=test`);
            if (proxyTest && proxyTest.success) {
                console.log('✅ Proxy test passed');
                return true;
            }
        } catch (proxyError) {
            console.error('Proxy test failed:', proxyError);
        }
        
        console.log('❌ All connection tests failed');
        return false;
    } catch (error) {
        console.error('Connection test error:', error);
        return false;
    }
}

async function checkSheetStructure() {
    try {
        showAlert('info', 'กำลังตรวจสอบโครงสร้างข้อมูล...');
        const result = await callAPI(`${SCRIPT_URL}?action=checkSheetStructure`);
        
        if (result.success) {
            showAlert('success', 'โครงสร้างข้อมูลถูกต้อง', 3000);
            return true;
        } else {
            showAlert('warning', 'กำลังซ่อมแซมโครงสร้างข้อมูล...');
            const repairResult = await callAPI(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'addSampleData' })
            });
            
            if (repairResult.success) {
                showAlert('success', 'ซ่อมแซมโครงสร้างข้อมูลสำเร็จ', 3000);
                return true;
            } else {
                showAlert('error', 'ไม่สามารถซ่อมแซมโครงสร้างข้อมูลได้');
                return false;
            }
        }
    } catch (error) {
        console.error('Error checking sheet structure:', error);
        showAlert('error', 'ไม่สามารถตรวจสอบโครงสร้างข้อมูลได้');
        return false;
    }
}

async function runSystemTest() {
    try {
        showAlert('info', 'กำลังทดสอบระบบ...');
        showLoading(true);
        
        const connectionTest = await testConnection();
        if (!connectionTest) throw new Error('การเชื่อมต่อล้มเหลว');
        
        const structureTest = await checkSheetStructure();
        if (!structureTest) throw new Error('โครงสร้างชีตมีปัญหา');
        
        const testStudent = {
            studentId: 'TEST' + Date.now(),
            studentName: 'นักเรียนทดสอบ',
            educationLevel: 'ปวช.1',
            major: 'สาขาทดสอบ',
            class: 'ทดสอบ',
            shift: 'เช้า'
        };
        
        const addResult = await callAPI(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'addStudent', ...testStudent })
        });
        
        if (addResult.success) {
            showAlert('success', '✅ ทดสอบระบบสำเร็จ! ระบบพร้อมใช้งาน', 5000);
            if (currentMode === 'admin') await loadStudentsTable();
        } else {
            throw new Error('การเพิ่มข้อมูลทดสอบล้มเหลว: ' + addResult.message);
        }
        
    } catch (error) {
        console.error('System test failed:', error);
        showAlert('error', '❌ การทดสอบระบบล้มเหลว: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// ==================== UTILITY FUNCTIONS ====================
function switchMode(mode) {
    currentMode = mode;
    
    document.getElementById('visitorModeBtn').classList.toggle('active', mode === 'visitor');
    document.getElementById('adminModeBtn').classList.toggle('active', mode === 'admin');
    
    document.getElementById('visitorMode').style.display = mode === 'visitor' ? 'block' : 'none';
    document.getElementById('adminMode').style.display = mode === 'admin' ? 'block' : 'none';
    
    document.body.className = mode + '-mode';
    
    document.getElementById('searchInput').value = '';
    document.getElementById('studentData').style.display = 'none';
    
    if (mode === 'admin' && !isAdminLoggedIn) {
        document.getElementById('adminLoginForm').style.display = 'block';
        document.getElementById('adminPanel').style.display = 'none';
        document.getElementById('reportSection').style.display = 'none';
    } else if (mode === 'admin' && isAdminLoggedIn) {
        document.getElementById('adminLoginForm').style.display = 'none';
        document.getElementById('adminPanel').style.display = 'block';
        loadStudentsTable();
        loadStatistics();
    }
    
    console.log('🔄 เปลี่ยนโหมดเป็น: ' + mode);
}

function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = show ? 'flex' : 'none';
}

function showAlert(type, message, duration = 5000) {
    const alerts = ['successAlert', 'errorAlert', 'infoAlert', 'warningAlert'];
    alerts.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    
    const alertDiv = document.getElementById(type + 'Alert');
    const messageSpan = document.getElementById(type + 'Message');
    
    if (!alertDiv || !messageSpan) {
        console.error('Alert elements not found for type:', type);
        return;
    }
    
    messageSpan.textContent = message;
    alertDiv.style.display = 'flex';
    
    const icon = alertDiv.querySelector('i');
    if (icon) {
        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
        icon.className = 'fas ' + (icons[type] || 'fa-info-circle');
    }
    
    const timeout = type === 'error' ? 8000 : duration;
    setTimeout(() => {
        if (alertDiv) alertDiv.style.display = 'none';
    }, timeout);
}

function updateTableCount(count) {
    const countElement = document.getElementById('tableCount');
    if (countElement) countElement.textContent = `พบข้อมูลทั้งหมด ${count} รายการ`;
}

// ==================== SAMPLE DATA ====================
function showSampleData(searchValue) {
    const sampleData = {
        '26737': {
            studentId: '26737',
            studentName: 'นายธนะชัย บำรุงราษฏร์',
            educationLevel: 'ปวช.1',
            major: 'ช่างไฟฟ้า',
            class: 'ปวช.ช่างไฟฟ้า',
            shift: 'เช้า',
            documents: {
                studentIdCard: { uploaded: true, fileName: 'student_id_26737.pdf' },
                studentHouseReg: { uploaded: false, fileName: '' },
                guardianIdCard: { father: { uploaded: true, fileName: 'father_id_26737.pdf' }, mother: { uploaded: false, fileName: '' }, other: { uploaded: false, fileName: '' } },
                guardianHouseReg: { father: { uploaded: true, fileName: 'father_house_26737.pdf' }, mother: { uploaded: false, fileName: '' }, other: { uploaded: false, fileName: '' } }
            }
        },
        '26767': {
            studentId: '26767',
            studentName: 'นายไพสิฐ สุนทรเทพวรากุล',
            educationLevel: 'ปวช.1',
            major: 'ช่างไฟฟ้า',
            class: 'ชฟ.1',
            shift: 'เช้า',
            documents: {
                studentIdCard: { uploaded: false, fileName: '' },
                studentHouseReg: { uploaded: true, fileName: 'student_house_26767.jpg' },
                guardianIdCard: { father: { uploaded: false, fileName: '' }, mother: { uploaded: true, fileName: 'mother_id_26767.pdf' }, other: { uploaded: false, fileName: '' } },
                guardianHouseReg: { father: { uploaded: false, fileName: '' }, mother: { uploaded: true, fileName: 'mother_house_26767.pdf' }, other: { uploaded: false, fileName: '' } }
            }
        }
    };
    
    const studentData = sampleData[searchValue] || Object.values(sampleData).find(s => s.studentName.includes(searchValue));
    
    if (studentData) {
        displayStudentData(studentData);
        updateDocumentStatus(studentData);
        document.getElementById('studentData').style.display = 'block';
        currentStudentId = studentData.studentId;
        showAlert('warning', 'แสดงข้อมูลตัวอย่าง (API ไม่สามารถเชื่อมต่อได้)');
    } else {
        showAlert('error', 'ไม่พบข้อมูลนักศึกษา: ' + searchValue);
        document.getElementById('studentData').style.display = 'none';
    }
}

function showSampleStudentsTable(searchValue) {
    const sampleStudents = [
        { id: '26737', name: 'นายธนะชัย บำรุงราษฏร์', level: 'ปวช.1', major: 'ช่างไฟฟ้า', class: 'ปวช.ช่างไฟฟ้า', shift: 'เช้า', docs: '4/8' },
        { id: '26767', name: 'นายไพสิฐ สุนทรเทพวรากุล', level: 'ปวช.1', major: 'ช่างไฟฟ้า', class: 'ชฟ.1', shift: 'เช้า', docs: '4/8' },
        { id: '26787', name: 'นายเพชรเกล้า ภูทองเทียม', level: 'ปวช.1', major: 'ช่างไฟฟ้า', class: 'ชฟ.1', shift: 'เช้า', docs: '8/8' }
    ];
    
    const filtered = searchValue ? sampleStudents.filter(s => s.id.includes(searchValue) || s.name.includes(searchValue)) : sampleStudents;
    populateStudentsTable(filtered);
    showAlert('warning', `แสดงข้อมูลตัวอย่าง ${filtered.length} รายการ (API ไม่สามารถเชื่อมต่อได้)`);
}

function getSampleStudents() {
    return [
        { id: '26737', name: 'นายธนะชัย บำรุงราษฏร์', level: 'ปวช.1', major: 'ช่างไฟฟ้า', class: 'ปวช.ช่างไฟฟ้า', shift: 'เช้า', docs: '4/8' },
        { id: '26767', name: 'นายไพสิฐ สุนทรเทพวรากุล', level: 'ปวช.1', major: 'ช่างไฟฟ้า', class: 'ชฟ.1', shift: 'เช้า', docs: '4/8' },
        { id: '26787', name: 'นายเพชรเกล้า ภูทองเทียม', level: 'ปวช.1', major: 'ช่างไฟฟ้า', class: 'ชฟ.1', shift: 'เช้า', docs: '8/8' },
        { id: '26466', name: 'นายจักรินทร์ แดนโคตรผม', level: 'ปวช.2', major: 'ช่างไฟฟ้า', class: 'ชฟ.2', shift: 'เช้า', docs: '2/8' },
        { id: '25883', name: 'นายณัฐพล บุญลือ', level: 'ปวส.1', major: 'ไฟฟ้า', class: 'ชฟ.1/1', shift: 'เช้า', docs: '0/8' }
    ];
}

// ==================== PRINT FUNCTIONS ====================
async function printStudentDocuments(studentId) {
    if (currentMode !== 'admin' || !isAdminLoggedIn) {
        showAlert('error', 'คุณไม่มีสิทธิ์ในการพิมพ์เอกสาร');
        return;
    }
    
    try {
        showAlert('info', 'กำลังเตรียมเอกสารสำหรับพิมพ์...');
        showLoading(true);
        
        const studentResult = await callAPI(`${SCRIPT_URL}?action=getStudent&studentId=${studentId}`);
        const documentsResult = await callAPI(`${SCRIPT_URL}?action=getStudentDocuments&studentId=${studentId}`);
        
        if (studentResult.success && documentsResult.success) {
            const student = studentResult.data;
            const documents = documentsResult.data;
            
            const printWindow = window.open('', '_blank');
            const printContent = generatePrintContent(student, documents);
            
            printWindow.document.write(printContent);
            printWindow.document.close();
            
            setTimeout(() => {
                printWindow.print();
                printWindow.onafterprint = () => {
                    printWindow.close();
                    showAlert('success', 'พิมพ์เอกสารเรียบร้อยแล้ว');
                };
            }, 1000);
        } else {
            showAlert('error', 'ไม่สามารถดึงข้อมูลเอกสารได้');
        }
    } catch (error) {
        console.error('Error printing documents:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการพิมพ์: ' + error.message);
        createSimplePrintView(studentId);
    } finally {
        showLoading(false);
    }
}

function generatePrintContent(student, documents) {
    const currentDate = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    
    const docItems = [
        { label: 'สำเนาบัตรประชาชนนักศึกษา', uploaded: documents.studentIdCard?.uploaded },
        { label: 'สำเนาทะเบียนบ้านนักศึกษา', uploaded: documents.studentHouseReg?.uploaded },
        { label: 'สำเนาบัตรประชาชนพ่อ', uploaded: documents.guardianIdCard?.father?.uploaded },
        { label: 'สำเนาทะเบียนบ้านพ่อ', uploaded: documents.guardianHouseReg?.father?.uploaded },
        { label: 'สำเนาบัตรประชาชนแม่', uploaded: documents.guardianIdCard?.mother?.uploaded },
        { label: 'สำเนาทะเบียนบ้านแม่', uploaded: documents.guardianHouseReg?.mother?.uploaded },
        { label: 'สำเนาบัตรประชาชนผู้ปกครองอื่น', uploaded: documents.guardianIdCard?.other?.uploaded },
        { label: 'สำเนาทะเบียนบ้านผู้ปกครองอื่น', uploaded: documents.guardianHouseReg?.other?.uploaded }
    ];
    
    let docListHtml = '';
    docItems.forEach(item => {
        docListHtml += `
            <div class="document-item">
                <strong>${item.label}:</strong>
                <span class="document-status ${item.uploaded ? 'status-uploaded' : 'status-missing'}">
                    ${item.uploaded ? '✓ อัปโหลดแล้ว' : '✗ ยังไม่ได้อัปโหลด'}
                </span>
            </div>
        `;
    });
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>เอกสารนักเรียน - ${student.name}</title>
            <meta charset="UTF-8">
            <style>
                body { font-family: 'Sarabun', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 20px; color: #333; line-height: 1.6; }
                .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
                .student-info { margin-bottom: 30px; background: #f8f9fa; padding: 20px; border-radius: 8px; }
                .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
                .info-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #ddd; }
                .documents-section { margin-top: 30px; }
                .document-list { margin-left: 20px; }
                .document-item { margin-bottom: 15px; padding: 10px; border-left: 4px solid #3498db; background: #f8f9fa; }
                .document-status { font-weight: bold; margin-left: 10px; }
                .status-uploaded { color: #27ae60; }
                .status-missing { color: #e74c3c; }
                .print-date { text-align: right; margin-top: 30px; color: #666; font-style: italic; }
                @media print { body { margin: 0; } .no-print { display: none; } @page { margin: 1cm; } }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>เอกสารนักเรียน</h1>
                <h2>กลุ่มงานไฟฟ้าและอิเล็กทรอนิกส์</h2>
            </div>
            <div class="student-info">
                <h3>ข้อมูลนักเรียน</h3>
                <div class="info-grid">
                    <div class="info-item"><strong>รหัสนักศึกษา:</strong><span>${student.id}</span></div>
                    <div class="info-item"><strong>ชื่อ-สกุล:</strong><span>${student.name}</span></div>
                    <div class="info-item"><strong>ระดับการศึกษา:</strong><span>${student.level}</span></div>
                    <div class="info-item"><strong>สาขาวิชา:</strong><span>${student.major}</span></div>
                    <div class="info-item"><strong>ชั้นเรียน:</strong><span>${student.class || '-'}</span></div>
                    <div class="info-item"><strong>รอบเรียน:</strong><span>${student.shift || '-'}</span></div>
                </div>
            </div>
            <div class="documents-section">
                <h3>สถานะเอกสาร</h3>
                <div class="document-list">${docListHtml}</div>
            </div>
            <div class="print-date">พิมพ์เมื่อ: ${currentDate}</div>
            <div class="no-print" style="margin-top: 30px; text-align: center;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #3498db; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px;">พิมพ์เอกสาร</button>
                <button onclick="window.close()" style="padding: 10px 20px; background: #e74c3c; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px;">ปิด</button>
            </div>
        </body>
        </html>
    `;
}

function createSimplePrintView(studentId) {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head><title>พิมพ์เอกสารนักเรียน</title><style>body{font-family:Arial,sans-serif;margin:20px;}.no-print{display:none;}</style></head>
        <body><h1>เอกสารนักเรียน รหัส: ${studentId}</h1><p>ไม่สามารถดึงข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง</p>
        <div class="no-print"><button onclick="window.print()">พิมพ์</button><button onclick="window.close()">ปิด</button></div>
        </body></html>
    `);
    printWindow.document.close();
}

// ==================== INITIALIZATION ====================
function setupEventListeners() {
    document.getElementById('visitorModeBtn').addEventListener('click', () => switchMode('visitor'));
    document.getElementById('adminModeBtn').addEventListener('click', () => switchMode('admin'));
    
    document.getElementById('searchBtn').addEventListener('click', searchStudent);
    document.getElementById('searchInput').addEventListener('keypress', e => e.key === 'Enter' && searchStudent());
    
    document.getElementById('adminLoginBtn').addEventListener('click', adminLogin);
    document.getElementById('adminPassword').addEventListener('keypress', e => e.key === 'Enter' && adminLogin());
    
    document.getElementById('adminLogoutBtn').addEventListener('click', adminLogout);
    
    document.getElementById('adminSearchBtn').addEventListener('click', adminSearch);
    document.getElementById('adminSearchInput').addEventListener('keypress', e => e.key === 'Enter' && adminSearch());
    
    document.querySelectorAll('#visitorMode .upload-doc').forEach(btn => {
        btn.addEventListener('click', function() {
            openUploadModal(this.dataset.doc, this.dataset.guardian);
        });
    });
    
    document.getElementById('closeUploadModal').addEventListener('click', closeUploadModal);
    document.getElementById('closeStudentModal').addEventListener('click', closeStudentModal);
    document.getElementById('closeDocumentViewModal').addEventListener('click', closeDocumentViewModal);
    document.getElementById('closeImportModal').addEventListener('click', closeImportModal);
    
    document.getElementById('dropZone').addEventListener('click', () => document.getElementById('fileInput').click());
    document.getElementById('fileInput').addEventListener('change', handleFileSelect);
    document.getElementById('confirmUploadBtn').addEventListener('click', confirmUpload);
    
    document.getElementById('addStudentBtn').addEventListener('click', openAddStudentModal);
    document.getElementById('saveStudentBtn').addEventListener('click', saveStudent);
    
    document.getElementById('importFromExcelBtn').addEventListener('click', openImportModal);
    document.getElementById('excelDropZone').addEventListener('click', () => document.getElementById('excelFileInput').click());
    document.getElementById('excelFileInput').addEventListener('change', handleExcelFileSelect);
    document.getElementById('confirmImportBtn').addEventListener('click', confirmImport);
    document.getElementById('importSampleDataBtn').addEventListener('click', importSampleData);
    
    document.getElementById('exportJsonBtn').addEventListener('click', exportToJSON);
    document.getElementById('exportExcelBtn').addEventListener('click', exportToExcel);
    
    document.getElementById('generateReportBtn').addEventListener('click', generateReport);
    document.getElementById('testSystemBtn').addEventListener('click', runSystemTest);
    document.getElementById('refreshCacheBtn').addEventListener('click', refreshCache);
    
    document.getElementById('selectAllBtn').addEventListener('click', selectAllStudents);
    document.getElementById('clearSelectionBtn').addEventListener('click', clearSelection);
    document.getElementById('bulkDeleteBtn').addEventListener('click', bulkDeleteStudents);
    document.getElementById('applyFilterBtn').addEventListener('click', applyFilters);
    
    document.getElementById('selectAllCheckbox').addEventListener('change', function() {
        document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = this.checked);
        updateSelectedCount();
    });
    
    setupModalCloseHandlers();
    setupDragAndDrop();
}

function setupModalCloseHandlers() {
    document.getElementById('uploadModal').addEventListener('click', e => e.target === this && closeUploadModal());
    document.getElementById('studentModal').addEventListener('click', e => e.target === this && closeStudentModal());
    document.getElementById('documentViewModal').addEventListener('click', e => e.target === this && closeDocumentViewModal());
    document.getElementById('importModal').addEventListener('click', e => e.target === this && closeImportModal());
}

function setupDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', e => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            document.getElementById('fileInput').files = e.dataTransfer.files;
            handleFileSelect({ target: document.getElementById('fileInput') });
        }
    });
    
    const excelDropZone = document.getElementById('excelDropZone');
    excelDropZone.addEventListener('dragover', e => { e.preventDefault(); excelDropZone.classList.add('dragover'); });
    excelDropZone.addEventListener('dragleave', e => { e.preventDefault(); excelDropZone.classList.remove('dragover'); });
    excelDropZone.addEventListener('drop', e => {
        e.preventDefault();
        excelDropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            document.getElementById('excelFileInput').files = e.dataTransfer.files;
            handleExcelFileSelect({ target: document.getElementById('excelFileInput') });
        }
    });
}

async function initializeApp() {
    switchMode('visitor');
    console.log('🚀 ระบบเริ่มทำงานแล้ว - โหมดผู้เยี่ยมชม');
    
    try {
        const isConnected = await testConnection();
        if (isConnected) {
            console.log('✅ Connected to Google Apps Script');
            showAlert('success', 'เชื่อมต่อกับระบบสำเร็จ', 3000);
            await checkSheetStructure();
        } else {
            console.log('❌ Cannot connect to Google Apps Script');
            showAlert('warning', 'ทำงานในโหมดออฟไลน์ - ข้อมูลอาจไม่เป็นปัจจุบัน', 5000);
            showConnectionTroubleshooting();
        }
    } catch (error) {
        console.error('Error during initialization:', error);
        showAlert('error', 'เกิดข้อผิดพลาดในการเริ่มต้นระบบ: ' + error.message);
    }
    
    setupFallbackLogin();
    backgroundSync.start();
    setTimeout(() => preloadCriticalData(), 1000);
}

async function preloadCriticalData() {
    try {
        if (currentMode === 'admin' && isAdminLoggedIn) {
            await loadAllStudentsWithCache();
            console.log('✅ Critical data preloaded');
        }
    } catch (error) {
        console.log('⚠️ Preloading failed:', error);
    }
}

function showConnectionTroubleshooting() {
    const html = `
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 15px 0;">
            <h4 style="color: #856404; margin-bottom: 10px;"><i class="fas fa-exclamation-triangle"></i> ปัญหาการเชื่อมต่อ</h4>
            <p style="color: #856404; margin-bottom: 10px;"><strong>วิธีการแก้ไข:</strong></p>
            <ol style="color: #856404; margin-left: 20px;">
                <li>ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต</li>
                <li>ลองรีเฟรชหน้าเว็บ</li>
                <li>ตรวจสอบว่า Google Apps Script ถูก deploy เป็น Web App แล้ว</li>
                <li>ตั้งค่า "Execute as" เป็น "Me" และ "Who has access" เป็น "Anyone"</li>
            </ol>
            <p style="color: #856404; font-size: 0.9em; margin-top: 10px;">ระบบจะทำงานในโหมดออฟไลน์จนกว่าจะสามารถเชื่อมต่อได้</p>
        </div>
    `;
    
    const visitorCard = document.querySelector('#visitorMode .card');
    const adminCard = document.querySelector('#adminMode .card');
    if (visitorCard) visitorCard.insertAdjacentHTML('afterbegin', html);
    if (adminCard) adminCard.insertAdjacentHTML('afterbegin', html);
}

// ==================== START APPLICATION ====================
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
});

console.log('🚀 ระบบจัดการเอกสารนักเรียนและบุคลากร - เวอร์ชัน 3.0 โหลดเสร็จสมบูรณ์');