// State Management
let currentInvoices = [];
let savedItems   = {}; // itemName -> price
let savedClients = {}; // clientName -> address
let savedTb      = new Set();
let savedBg      = new Set();
let clientHistory = {}; // clientName -> { address, site, noPo } (latest)
let uniqueSites = new Set();
let uniquePos   = new Set();
let editingId   = null;
let currentPage = 1;
let itemsPerPage = 10;
let totalItems = 0;
let statsData = []; // Cache for stats and metadata
let searchDebounceTimer = null; // Debounce timer for search
let searchFilteredData = null; // Hasil filter client-side (null = tidak ada active search)

// Analytics Chart Instances & State
let revenueChart = null;
let typeChart = null;
let paymentChart = null;
let analyticsRangeMonths = 6;

const views = {
    dashboard: document.getElementById('view-dashboard'),
    analytics: document.getElementById('view-analytics'),
    create: document.getElementById('view-create')
};
const navs = {
    dashboard: document.getElementById('nav-dashboard'),
    analytics: document.getElementById('nav-analytics'),
    create: document.getElementById('nav-create')
};

function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

function switchView(viewName) {
    Object.values(views).forEach(v => { if (v) v.style.display = 'none'; });
    Object.values(navs).forEach(n => { if (n) n.classList.remove('active'); });
    if (views[viewName]) views[viewName].style.display = 'block';
    if (navs[viewName]) navs[viewName].classList.add('active');
    closeMobileSidebar();
}

document.getElementById('nav-dashboard').addEventListener('click', () => { switchView('dashboard'); loadInvoices(1); });
document.getElementById('nav-analytics')?.addEventListener('click', () => { switchView('analytics'); renderAnalyticsDashboard(); });
document.getElementById('nav-create').addEventListener('click', () => { showCreate('normal'); });
document.getElementById('nav-create-rental').addEventListener('click', () => { showCreate('rental'); });


function showDashboard() { switchView('dashboard'); loadInvoices(1); }

function showCreate(type = 'normal') { 
    editingId = null;
    switchView('create'); 
    resetForm(); 
    closeMobileSidebar();
    window.setFormType(type);
    document.getElementById('submit-btn').innerHTML = '<i class="fa-solid fa-save"></i> Simpan ke Appwrite';
}

window.setFormType = function(type) {
    const isRental = type === 'rental';
    const targetType = isRental ? 'rental' : 'normal';
    
    document.getElementById('inv-type').value = targetType;
    
    // Update Switch Buttons Active State
    const normalBtn = document.getElementById('switch-type-normal');
    const rentalBtn = document.getElementById('switch-type-rental');
    if (normalBtn) normalBtn.classList.toggle('active', !isRental);
    if (rentalBtn) rentalBtn.classList.toggle('active', isRental);
    
    // Update Sidebar Navigation Active State
    if (navs.create) navs.create.classList.toggle('active', !isRental);
    const navRental = document.getElementById('nav-create-rental');
    if (navRental) navRental.classList.toggle('active', isRental);

    // Update Form Title
    const isEditing = Boolean(editingId);
    document.getElementById('form-title').textContent = isEditing 
        ? (isRental ? 'Edit Invoice Sewa' : 'Edit Invoice Reguler')
        : (isRental ? 'Buat Invoice Sewa' : 'Buat Invoice Reguler');

    // Toggle Field Visibilities
    document.querySelectorAll('.rental-only').forEach(el => el.style.display = isRental ? 'flex' : 'none');
    document.querySelectorAll('.normal-only').forEach(el => el.style.display = isRental ? 'none' : 'block');
    
    // Toggle Item Table Columns
    document.querySelectorAll('.item-extra-col').forEach(el => el.style.display = isRental ? 'none' : 'block');
    document.querySelectorAll('.rental-desc-col').forEach(el => el.style.display = isRental ? 'block' : 'none');

    // Adjust Invoice Number Prefix if using standard prefix pattern
    const invNumInput = document.getElementById('inv-number');
    if (invNumInput && !editingId) {
        let val = invNumInput.value.trim();
        if (!val || val.startsWith('INV') || val.startsWith('SW')) {
            window.generateInvNumber(isRental ? 'SW' : 'INV');
        }
    }

    // Auto-fill last notes for rental if empty
    if (isRental && !document.getElementById('inv-notes').value.trim()) {
        let lastNotes = '';
        const invoicesToSearch = statsData.length > 0 ? statsData : currentInvoices;
        for (let inv of invoicesToSearch) {
            try {
                let noteData = inv.note ? (typeof inv.note === 'string' ? JSON.parse(inv.note) : inv.note) : null;
                if (noteData && noteData.type === 'rental' && noteData.notes) {
                    lastNotes = noteData.notes;
                    break;
                }
            } catch(e) {}
        }
        if (lastNotes) {
            document.getElementById('inv-notes').value = lastNotes;
        }
    }
}

// Formulir Interaktif Items
function createItemRow(id) {
    const div = document.createElement('div');
    div.className = 'item-row';
    div.id = `item-row-${id}`;
    div.innerHTML = `
        <div class="form-group" style="margin-bottom:0">
            <label>Deskripsi</label>
            <input type="text" class="item-name" list="saved-items-list" placeholder="Misal: Jasa Desain Web" required oninput="handleItemSelect(this)">
        </div>
        <div class="form-group qty-col" style="margin-bottom:0">
            <label>Qty</label>
            <input type="number" class="item-qty" value="1" min="1" required oninput="calculateTotal()">
        </div>
        <div class="form-group price-col" style="margin-bottom:0">
            <label>Harga (Rp)</label>
            <input type="number" class="item-price" value="0" min="0" required oninput="calculateTotal()">
        </div>
        <div class="form-group item-extra-col" style="margin-bottom:0; width: 120px;">
            <label>TB</label>
            <input type="text" class="item-tb" list="saved-tb-list" placeholder="KSA..." onfocus="this.showPicker && this.showPicker()">
        </div>
        <div class="form-group item-extra-col" style="margin-bottom:0; width: 120px;">
            <label>BG</label>
            <input type="text" class="item-bg" list="saved-tb-list" placeholder="BG..." onfocus="this.showPicker && this.showPicker()">
        </div>
        <div class="form-group rental-desc-col" style="margin-bottom:0; flex: 2; display: none;">
            <label>Keterangan</label>
            <input type="text" class="item-desc" placeholder="Catatan...">
        </div>
        <button type="button" class="btn btn-danger btn-action" onclick="removeItemRow(${id})" style="height:42px;"><i class="fa-solid fa-trash"></i></button>
    `;
    
    // Hide TB/BG if rental, Show Rental Desc
    const type = document.getElementById('inv-type')?.value;
    if (type === 'rental') {
        div.querySelectorAll('.item-extra-col').forEach(el => el.style.display = 'none');
        div.querySelectorAll('.rental-desc-col').forEach(el => el.style.display = 'block');
    }
    
    return div;
}

let itemCount = 0;
function addItemRow() {
    itemCount++;
    document.getElementById('items-container').appendChild(createItemRow(itemCount));
}

window.removeItemRow = function(id) {
    const row = document.getElementById(`item-row-${id}`);
    if (row) row.remove();
    calculateTotal();
}

window.calculateTotal = function() {
    let total = 0;
    const rows = document.querySelectorAll('.item-row');
    rows.forEach(row => {
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        const price = parseFloat(row.querySelector('.item-price').value) || 0;
        total += (qty * price);
    });
    document.getElementById('grand-total').textContent = total.toLocaleString('id-ID');
    return Number(total.toFixed(0)); // Ensure it's a clean integer for Appwrite if needed
}

window.handleItemSelect = function(element) {
    const selectedName = element.value;
    if (savedItems[selectedName] !== undefined) {
        const row = element.closest('.item-row');
        const priceInput = row.querySelector('.item-price');
        priceInput.value = savedItems[selectedName];
        calculateTotal();
    }
}

window.handleClientSelect = function(element) {
    const selectedName = element.value;
    if (clientHistory[selectedName]) {
        const hist = clientHistory[selectedName];
        if (hist.address) document.getElementById('inv-wa').value = hist.address;
        if (hist.site)    document.getElementById('inv-site').value = hist.site;
        if (hist.noPo)    document.getElementById('inv-po').value = hist.noPo;
    }
}


// ══════════════════════════════════════════════════════
//  TOAST NOTIFICATION SYSTEM – Universal Feedback
// ══════════════════════════════════════════════════════

const TOAST_ICONS = {
    success: 'fa-circle-check',
    error:   'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info:    'fa-circle-info'
};
const TOAST_TITLES = {
    success: 'Berhasil',
    error:   'Gagal',
    warning: 'Peringatan',
    info:    'Informasi'
};
const TOAST_DURATIONS = {
    success: 4000,
    error:   6000,
    warning: 5000,
    info:    4000
};

/**
 * Tampilkan toast notification modern.
 * @param {string} message - Pesan yang ditampilkan
 * @param {'success'|'error'|'warning'|'info'} type - Tipe toast
 * @param {number} [duration] - Durasi ms (opsional, default sesuai tipe)
 */
function showToast(message, type = 'info', duration) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const ms = duration || TOAST_DURATIONS[type] || 4000;
    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fa-solid ${TOAST_ICONS[type]}"></i></div>
        <div class="toast-body">
            <div class="toast-title">${TOAST_TITLES[type]}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close-btn" title="Tutup"><i class="fa-solid fa-xmark"></i></button>
        <div class="toast-progress" style="animation-duration: ${ms}ms;"></div>
    `;

    // Close button
    toast.querySelector('.toast-close-btn').onclick = () => dismissToast(toast);

    container.appendChild(toast);

    // Auto dismiss
    const timer = setTimeout(() => dismissToast(toast), ms);
    toast._timer = timer;

    // Pause progress on hover
    toast.addEventListener('mouseenter', () => {
        clearTimeout(toast._timer);
        const prog = toast.querySelector('.toast-progress');
        if (prog) prog.style.animationPlayState = 'paused';
    });
    toast.addEventListener('mouseleave', () => {
        const prog = toast.querySelector('.toast-progress');
        if (prog) prog.style.animationPlayState = 'running';
        toast._timer = setTimeout(() => dismissToast(toast), 2000);
    });

    // Limit max visible toasts
    const all = container.querySelectorAll('.toast-item:not(.toast-exit)');
    if (all.length > 5) dismissToast(all[0]);
}

function dismissToast(el) {
    if (!el || el.classList.contains('toast-exit')) return;
    clearTimeout(el._timer);
    el.classList.add('toast-exit');
    el.addEventListener('animationend', () => el.remove(), { once: true });
}

/**
 * Tampilkan dialog konfirmasi kustom (pengganti confirm()).
 * @param {string} title - Judul dialog
 * @param {string} message - Pesan dialog
 * @param {Object} [opts] - Opsi: confirmText, cancelText, type ('danger'|'warning'), icon
 * @returns {Promise<boolean>} - true jika user mengkonfirmasi
 */
function showConfirm(title, message, opts = {}) {
    return new Promise(resolve => {
        const type = opts.type || 'danger';
        const icon = opts.icon || (type === 'danger' ? 'fa-trash-can' : 'fa-right-from-bracket');
        const confirmText = opts.confirmText || (type === 'danger' ? 'Hapus' : 'Lanjutkan');
        const cancelText = opts.cancelText || 'Batal';

        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
            <div class="confirm-card">
                <div class="confirm-icon ${type}"><i class="fa-solid ${icon}"></i></div>
                <div class="confirm-title">${title}</div>
                <div class="confirm-message">${message}</div>
                <div class="confirm-actions">
                    <button class="confirm-btn-cancel">${cancelText}</button>
                    <button class="confirm-btn-confirm ${type}">${confirmText}</button>
                </div>
            </div>
        `;

        const close = (result) => {
            overlay.classList.add('confirm-exit');
            overlay.addEventListener('animationend', () => {
                overlay.remove();
                resolve(result);
            }, { once: true });
        };

        overlay.querySelector('.confirm-btn-cancel').onclick = () => close(false);
        overlay.querySelector('.confirm-btn-confirm').onclick = () => close(true);
        // Click backdrop to cancel
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(false);
        });
        // Escape key to cancel
        const escHandler = (e) => {
            if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);

        const root = document.getElementById('confirm-modal-root');
        if (root) root.appendChild(overlay);
        else document.body.appendChild(overlay);
    });
}

// ══════════════════════════════════════════════════════
//  NOTIFICATION SYSTEM – Pengingat Invoice Sewa
// ══════════════════════════════════════════════════════

let notifications = [];   // array of notif objects
let notifDismissed = JSON.parse(localStorage.getItem('notif_dismissed') || '[]');

/**
 * Cek invoice sewa yang akan habis dalam 7 hari.
 * Dipanggil setelah statsData/currentInvoices tersedia.
 */
function checkRentalNotifications(docs) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newNotifs = [];

    docs.forEach(inv => {
        try {
            const noteData = inv.note
                ? (typeof inv.note === 'string' ? JSON.parse(inv.note) : inv.note)
                : null;

            if (!noteData || !noteData.rental || !noteData.rental.akhir) return;

            const endDate = new Date(noteData.rental.akhir);
            endDate.setHours(0, 0, 0, 0);
            const diffDays = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

            // Hanya notifikasi untuk yang akan habis dalam 7 hari ke depan (termasuk sudah lewat = 0 atau negatif)
            if (diffDays > 7) return;

            const clientName = Array.isArray(inv.clientName) ? inv.clientName[0] : inv.clientName;
            const key = `${inv.$id}_${noteData.rental.akhir}`;

            let level, label, icon;
            if (diffDays < 0) {
                level = 'urgent'; icon = 'fa-triangle-exclamation';
                label = `Sudah berakhir ${Math.abs(diffDays)} hari lalu`;
            } else if (diffDays === 0) {
                level = 'urgent'; icon = 'fa-triangle-exclamation';
                label = 'Berakhir hari ini!';
            } else if (diffDays === 1) {
                level = 'urgent'; icon = 'fa-fire';
                label = 'Berakhir besok!';
            } else if (diffDays <= 3) {
                level = 'warning'; icon = 'fa-clock';
                label = `${diffDays} hari lagi`;
            } else {
                level = 'info'; icon = 'fa-bell';
                label = `${diffDays} hari lagi`;
            }

            newNotifs.push({
                id: key,
                invoiceId: inv.$id,
                noInvoice: inv.NoInvoice || '-',
                clientName,
                endDate: endDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
                diffDays,
                level,
                icon,
                label,
                dismissed: notifDismissed.includes(key)
            });
        } catch(e) {}
    });

    // Urutkan: paling dekat / sudah lewat duluan
    newNotifs.sort((a, b) => a.diffDays - b.diffDays);
    notifications = newNotifs;
    renderNotifications();
}

function renderNotifications() {
    const badge   = document.getElementById('notif-badge');
    const listEl  = document.getElementById('notif-list');
    const bellBtn = document.getElementById('notif-bell-btn');
    if (!badge || !listEl || !bellBtn) return;

    const active = notifications.filter(n => !n.dismissed);

    // Update badge
    if (active.length > 0) {
        badge.style.display = 'flex';
        badge.textContent = active.length > 99 ? '99+' : active.length;
        bellBtn.classList.add('has-notif');
    } else {
        badge.style.display = 'none';
        bellBtn.classList.remove('has-notif');
    }

    // Render list
    if (notifications.length === 0) {
        listEl.innerHTML = '<div class="notif-empty"><i class="fa-solid fa-inbox"></i><br>Tidak ada notifikasi</div>';
        return;
    }

    listEl.innerHTML = '';
    notifications.forEach(n => {
        const item = document.createElement('div');
        item.className = `notif-item ${n.level} ${n.dismissed ? 'dismissed' : ''}`;
        item.style.opacity = n.dismissed ? '0.45' : '1';
        item.innerHTML = `
            <div class="notif-item-icon"><i class="fa-solid ${n.icon}"></i></div>
            <div class="notif-item-body">
                <div class="notif-item-title">${n.noInvoice} – ${n.clientName || '-'}</div>
                <div class="notif-item-desc">Sewa berakhir: ${n.endDate}</div>
                <div class="notif-item-time">${n.label}</div>
            </div>
            <button class="notif-dismiss-btn" title="${n.dismissed ? 'Sudah dibaca' : 'Tandai sudah dibaca'}">
                <i class="fa-solid ${n.dismissed ? 'fa-check-circle' : 'fa-check'}"></i>
            </button>
        `;
        // Tombol dismiss per item
        const dismissBtn = item.querySelector('.notif-dismiss-btn');
        dismissBtn.onclick = (e) => {
            e.stopPropagation(); // jangan trigger klik item
            dismissNotification(n.id);
        };
        // Klik body item → buka dashboard
        item.onclick = (e) => {
            if (e.target.closest('.notif-dismiss-btn')) return;
            showDashboard();
            toggleNotifPanel(false);
        };
        listEl.appendChild(item);
    });
}

window.toggleNotifPanel = function(forceState) {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const isOpen = panel.classList.contains('open');
    const shouldOpen = forceState !== undefined ? forceState : !isOpen;
    if (shouldOpen) {
        panel.classList.add('open');
    } else {
        panel.classList.remove('open');
    }
};

window.dismissNotification = function(id) {
    const notif = notifications.find(n => n.id === id);
    if (!notif) return;
    notif.dismissed = !notif.dismissed; // toggle: bisa un-dismiss juga
    if (notif.dismissed) {
        if (!notifDismissed.includes(id)) notifDismissed.push(id);
    } else {
        notifDismissed = notifDismissed.filter(d => d !== id);
    }
    localStorage.setItem('notif_dismissed', JSON.stringify(notifDismissed));
    renderNotifications();
};

window.clearNotifications = function() {
    notifDismissed = notifications.map(n => n.id);
    localStorage.setItem('notif_dismissed', JSON.stringify(notifDismissed));
    notifications.forEach(n => n.dismissed = true);
    renderNotifications();
};

// Tutup panel jika klik di luar area notifikasi
document.addEventListener('click', function(e) {
    const wrapper = document.getElementById('notif-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        const panel = document.getElementById('notif-panel');
        if (panel) panel.classList.remove('open');
    }
});


// Load Invoices
async function loadInvoices(page = 1) {
    const tbody = document.getElementById('invoice-list');
    currentPage = page;
    const offset = (page - 1) * itemsPerPage;
    const searchQuery = document.getElementById('search-input').value;
    const typeFilter = document.getElementById('type-filter-select')?.value || 'all';
    
    try {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center loading-text"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data tagihan...</td></tr>';
        
        const result = await API.getInvoices(itemsPerPage, offset, searchQuery, typeFilter);
        currentInvoices = result.documents;
        totalItems = result.total;
        
        // Render Table
        renderInvoiceTable(currentInvoices);
        renderPagination();
        
        // Selalu refresh metadata dari data yang sudah ada
        if (statsData.length > 0) {
            // Jika stats sudah di-cache, langsung refresh dari cache
            refreshMetadata(statsData);
        } else {
            // Pertama kali load: langsung pakai data page saat ini dulu,
            // lalu fetch metadata lengkap di background
            refreshMetadata(currentInvoices);
            loadStatsAndMetadata(); // Non-blocking background fetch
        }
        
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation"></i> Error Koneksi: ${e.message}</td></tr>`;
    }
}

async function loadStatsAndMetadata() {
    try {
        const docs = await API.getInvoicesStats();
        statsData = docs;
        updateStats(docs);
        // Refresh ulang metadata dengan data lengkap dari semua docs
        refreshMetadata(docs);
        // Cek notifikasi sewa dari data lengkap
        checkRentalNotifications(docs);
        // Render Dashboard Analitik Kesehatan Bisnis
        renderAnalyticsDashboard(docs);

        // Jika ada active search/filter saat statsData selesai dimuat, refresh hasilnya
        const activeQuery = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
        const activeFilter = document.getElementById('type-filter-select')?.value || 'all';
        if (activeQuery || activeFilter !== 'all') {
            performClientSideSearch(activeQuery, activeFilter);
        }
    } catch (e) {
        console.error("Error loading stats:", e);
        // Fallback: gunakan data yang sudah ter-render sebelumnya
        if (currentInvoices.length > 0) {
            refreshMetadata(currentInvoices);
            checkRentalNotifications(currentInvoices);
            renderAnalyticsDashboard(currentInvoices);
        }
    }
}

function renderPagination() {
    const container = document.getElementById('page-numbers');
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const totalInfo = document.getElementById('total-info');
    
    totalInfo.textContent = `Total: ${totalItems}`;
    container.innerHTML = '';
    
    if (totalPages <= 1) {
        document.getElementById('pagination-controls').style.display = totalItems > 0 ? 'flex' : 'none';
        if (totalPages === 1) {
            container.innerHTML = '<span class="page-num active">1</span>';
        }
        updatePaginationButtons(totalPages);
        return;
    }
    document.getElementById('pagination-controls').style.display = 'flex';

    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    for (let i = startPage; i <= endPage; i++) {
        const span = document.createElement('span');
        span.className = `page-num ${i === currentPage ? 'active' : ''}`;
        span.textContent = i;
        span.onclick = () => navigateToPage(i);
        container.appendChild(span);
    }
    
    updatePaginationButtons(totalPages);
}

function updatePaginationButtons(totalPages) {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
    
    prevBtn.style.opacity = prevBtn.disabled ? '0.5' : '1';
    nextBtn.style.opacity = nextBtn.disabled ? '0.5' : '1';
}

window.changePage = function(delta) {
    const newPage = currentPage + delta;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (newPage >= 1 && newPage <= totalPages) {
        navigateToPage(newPage);
    }
}

// Navigasi halaman — otomatis pilih mode client-side atau server-side
function navigateToPage(page) {
    if (searchFilteredData !== null) {
        // Mode client-side search: paginate dari searchFilteredData
        currentPage = page;
        const offset = (page - 1) * itemsPerPage;
        const pageData = searchFilteredData.slice(offset, offset + itemsPerPage);
        currentInvoices = pageData;
        renderInvoiceTable(pageData);
        renderPagination();
    } else {
        loadInvoices(page);
    }
}

function refreshMetadata(docs) {
    const freshItems    = {};
    const freshTb       = new Set();
    const freshBg       = new Set();
    const freshHistory  = {};
    const freshSites    = new Set();
    const freshPos      = new Set();
    
    docs.forEach(inv => {
        try {
            let itemsData = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items;
            let noteData = inv.note ? (typeof inv.note === 'string' ? JSON.parse(inv.note) : inv.note) : null;
            let itemsArray = [];

            // Kolom tb dan bg terpisah (format baru)
            const tbColRaw = inv.tb ? (typeof inv.tb === 'string' ? JSON.parse(inv.tb) : inv.tb) : null;
            const bgColRaw = inv.bg ? (typeof inv.bg === 'string' ? JSON.parse(inv.bg) : inv.bg) : null;
            
            if (noteData) {
                itemsArray = Array.isArray(itemsData) ? itemsData : [];
                itemsArray.forEach(i => {
                    if (i.name) freshItems[i.name] = i.price || 0;
                });
                const tbSrc = Array.isArray(tbColRaw) ? tbColRaw : (noteData.tb || []);
                const bgSrc = Array.isArray(bgColRaw) ? bgColRaw : (noteData.bg || []);
                tbSrc.forEach(tb => { if (tb && String(tb).toUpperCase() !== "NO-ENTRY") freshTb.add(String(tb)); });
                bgSrc.forEach(bg => { if (bg && String(bg).toUpperCase() !== "NO-ENTRY") freshBg.add(String(bg)); });
            } else {
                itemsArray = itemsData?.itemList || (Array.isArray(itemsData) ? itemsData : []);
                itemsArray.forEach(i => {
                    if (i.name) freshItems[i.name] = i.price || 0;
                    if (i.tb && String(i.tb).toUpperCase() !== "NO-ENTRY") freshTb.add(String(i.tb));
                    if (i.bg && String(i.bg).toUpperCase() !== "NO-ENTRY") freshBg.add(String(i.bg));
                });
            }

            const cName = Array.isArray(inv.clientName) ? inv.clientName[0] : inv.clientName;
            const cAddr = inv.clientAddress || inv.waNumber || '';
            const cSite = inv.site || '';
            const cPo   = inv.noPo || '';

            if (cSite) freshSites.add(cSite);
            if (cPo)   freshPos.add(cPo);
            if (cName && !freshHistory[cName]) {
                freshHistory[cName] = { address: cAddr, site: cSite, noPo: cPo };
            }
        } catch(e) {}
    });

    savedItems = freshItems; savedTb = freshTb; savedBg = freshBg;
    clientHistory = freshHistory; uniqueSites = freshSites; uniquePos = freshPos;

    populateDL('saved-items-list', Object.keys(savedItems));
    populateDL('client-names-list', Object.keys(clientHistory));
    populateDL('saved-tb-list', savedTb);
    populateDL('saved-bg-list', savedBg);
    populateDL('site-list', uniqueSites);
    populateDL('po-list', uniquePos);
}

function populateDL(id, values) {
    const dl = document.getElementById(id);
    if (!dl) return;
    const arr = Array.from(values).filter(v => v && String(v).trim() !== "");
    dl.innerHTML = arr.map(v => `<option value="${v}">`).join('');
}

window.filterInvoices = function() {
    // Tampilkan/sembunyikan tombol clear
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.style.display = searchInput?.value ? 'flex' : 'none';

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        const query = searchInput.value.trim().toLowerCase();
        const typeFilter = document.getElementById('type-filter-select')?.value || 'all';

        // --- Hybrid Search: Client-side jika statsData sudah ter-cache ---
        if (statsData.length > 0) {
            performClientSideSearch(query, typeFilter);
        } else {
            // Fallback: server-side search (statsData belum ready)
            loadInvoices(1);
        }
    }, 300);
}

window.clearSearch = function() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.style.display = 'none';
    searchFilteredData = null;
    loadInvoices(1);
}

// Client-side search pada statsData dengan paginasi lokal
function performClientSideSearch(query, typeFilter) {
    // Jika tidak ada query dan filter = all, kembali ke mode server-side normal
    if (!query && typeFilter === 'all') {
        searchFilteredData = null;
        loadInvoices(1);
        return;
    }

    let filtered = statsData;

    // Filter berdasarkan tipe
    if (typeFilter === 'rental') {
        filtered = filtered.filter(inv => String(inv.NoInvoice || '').toUpperCase().startsWith('SW'));
    } else if (typeFilter === 'normal') {
        filtered = filtered.filter(inv => String(inv.NoInvoice || '').toUpperCase().startsWith('INV'));
    }

    // Filter berdasarkan query pencarian (partial match, case-insensitive, multi-kata)
    if (query) {
        const keywords = query.split(/\s+/).filter(k => k.length > 0);
        filtered = filtered.filter(inv => {
            const noInv = String(inv.NoInvoice || '').toLowerCase();
            const clientRaw = Array.isArray(inv.clientName) ? inv.clientName[0] : inv.clientName;
            const client = String(clientRaw || '').toLowerCase();
            // Setiap keyword dicek: minimal muncul di noInvoice ATAU clientName
            return keywords.every(kw => noInv.includes(kw) || client.includes(kw));
        });
    }

    // Simpan hasil filter dan render dengan paginasi lokal
    searchFilteredData = filtered;
    totalItems = filtered.length;
    currentPage = 1;

    const pageData = filtered.slice(0, itemsPerPage);
    currentInvoices = pageData;

    renderInvoiceTable(pageData);
    renderPagination();
}

window.sortInvoices = function() {
    renderInvoiceTable(currentInvoices);
}

function renderInvoiceTable(docs) {
    const tbody = document.getElementById('invoice-list');
    const sortMethod = document.getElementById('sort-select').value;
    
    // Process each doc to determine type and description
    let items = docs.map(invoice => {
        let isRental = false;
        let itemKeterangan = '-';
        try {
            const data = typeof invoice.items === 'string' ? JSON.parse(invoice.items) : invoice.items;
            const noteData = invoice.note ? (typeof invoice.note === 'string' ? JSON.parse(invoice.note) : invoice.note) : null;
            
            isRental = (noteData && noteData.type === 'rental') || 
                       (data && data.type === 'rental') || 
                       (invoice.NoInvoice && String(invoice.NoInvoice).toUpperCase().startsWith('SW')) ||
                       Boolean(noteData && noteData.rental && (noteData.rental.awal || noteData.rental.akhir));
            const arr = noteData ? (Array.isArray(data) ? data : []) : (data?.itemList || (Array.isArray(data) ? data : []));
            itemKeterangan = arr.map(i => i.name).join(', ') || '-';
            if (itemKeterangan.length > 50) itemKeterangan = itemKeterangan.substring(0, 50) + '...';
        } catch(e) {}
        return { invoice, isRental, itemKeterangan };
    });

    // Catatan: filter tipe (Reguler/Sewa) kini dilakukan server-side di loadInvoices/API
    // sehingga totalItems sudah akurat untuk pagination.

    // Sort
    items.sort((a, b) => {
        if (sortMethod === 'createdAt') {
            return new Date(b.invoice.$createdAt) - new Date(a.invoice.$createdAt);
        } else if (sortMethod === 'dateNewest') {
            return new Date(b.invoice.date) - new Date(a.invoice.date);
        } else if (sortMethod === 'dateOldest') {
            return new Date(a.invoice.date) - new Date(b.invoice.date);
        }
        return 0;
    });

    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:var(--text-muted)">Data tidak ditemukan.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    items.forEach(({ invoice, isRental, itemKeterangan }) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong>${invoice.NoInvoice}</strong>
                <br><span class="badge ${isRental ? 'badge-sewa' : 'badge-reguler'}">${isRental ? 'Sewa' : 'Reguler'}</span>
            </td>
            <td>${Array.isArray(invoice.clientName) ? invoice.clientName[0] : invoice.clientName}</td>
            <td style="font-size:0.85em;">${itemKeterangan}</td>
            <td>${new Date(invoice.date).toLocaleDateString('id-ID')}</td>
            <td style="font-weight:600; color:var(--text-main)">Rp ${Number(invoice.totalAmount).toLocaleString('id-ID')}</td>
            <td>
                <select class="status-select" onchange="updatePaymentStatus('${invoice.$id}', this.value)" style="padding: 4px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text-main);">
                    <option value="pending" ${invoice.paymentStatus === 'pending' ? 'selected' : ''}>Pending</option>
                    <option value="paid" ${invoice.paymentStatus === 'paid' ? 'selected' : ''}>Paid</option>
                    <option value="overdue" ${invoice.paymentStatus === 'overdue' ? 'selected' : ''}>Overdue</option>
                </select>
            </td>
            <td class="action-cell">
                <div class="action-wrapper">
                    ${isRental ? `<button class="btn btn-success btn-action" onclick="createRentalForThisMonth('${invoice.$id}')" title="Buat Invoice Sewa Bulan Ini"><i class="fa-solid fa-calendar-plus"></i></button>` : ''}
                    <button class="btn btn-primary btn-action" onclick="nativeShare('${invoice.$id}')" title="Share"><i class="fa-solid fa-share-nodes"></i></button>
                    <button class="btn btn-secondary btn-action" onclick="downloadPDF('${invoice.$id}')" title="PDF"><i class="fa-solid fa-download"></i></button>
                    <button class="btn btn-warning btn-action" onclick="editInvoice('${invoice.$id}')" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="btn btn-danger btn-action" onclick="deleteInvoice('${invoice.$id}')" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateStats(docs) {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    
    let totalAll = 0;
    let countAll = docs.length;
    let totalMonth = 0;
    let countMonth = 0;
    
    docs.forEach(inv => {
        const amount = Number(inv.totalAmount) || 0;
        totalAll += amount;
        
        const invDate = new Date(inv.date);
        if (invDate.getMonth() === thisMonth && invDate.getFullYear() === thisYear) {
            totalMonth += amount;
            countMonth++;
        }
    });
    
    document.getElementById('stat-month-total').textContent = 'Rp ' + totalMonth.toLocaleString('id-ID');
    document.getElementById('stat-month-count').textContent = countMonth + ' Invoice';
    document.getElementById('stat-all-total').textContent = 'Rp ' + totalAll.toLocaleString('id-ID');
    document.getElementById('stat-all-count').textContent = countAll + ' Invoice';
}

// Create Invoice Submit
function getInvoiceFormData() {
    const items = [];
    const tbArr = [];
    const bgArr = [];
    const descArr = [];
    document.querySelectorAll('.item-row').forEach(row => {
        items.push({
            name:  row.querySelector('.item-name').value,
            qty:   Number(row.querySelector('.item-qty').value),
            price: Number(row.querySelector('.item-price').value)
        });
        tbArr.push(row.querySelector('.item-tb').value.trim() || "NO-ENTRY");
        bgArr.push(row.querySelector('.item-bg').value.trim() || "NO-ENTRY");
        descArr.push(row.querySelector('.item-desc') ? row.querySelector('.item-desc').value.trim() : "");
    });

    const clientNameValue = document.getElementById('inv-client').value;
    const clientAddrValue = document.getElementById('inv-wa').value;
    const poValue   = document.getElementById('inv-po').value;
    const siteValue = document.getElementById('inv-site').value;
    const dateValue = document.getElementById('inv-date').value;
    
    let clientHash = 0;
    for (let i = 0; i < clientNameValue.length; i++) {
        clientHash = ((clientHash << 5) - clientHash) + clientNameValue.charCodeAt(i);
        clientHash |= 0;
    }
    const numericClientId = Math.abs(clientHash) || Math.floor(Math.random() * 100000);

    const isoDate = dateValue ? new Date(dateValue).toISOString() : new Date().toISOString();
    const typeValue = document.getElementById('inv-type').value;
    const sewaAwal  = document.getElementById('sewa-awal').value;
    const sewaAkhir = document.getElementById('sewa-akhir').value;

    return {
        invoiceId:     Math.floor(Math.random() * 1000000000),
        NoInvoice:     document.getElementById('inv-number').value,
        clientId:      numericClientId,
        clientName:    [clientNameValue],
        clientAddress: clientAddrValue,
        noPo:          poValue,
        site:          siteValue,
        date:          isoDate,
        issueDate:     isoDate,
        paymentStatus: "pending",
        items:         JSON.stringify(items),
        tb:            JSON.stringify(tbArr),
        bg:            JSON.stringify(bgArr),
        note:          JSON.stringify({
            type:     typeValue,
            rental:   { awal: sewaAwal, akhir: sewaAkhir },
            notes:    document.getElementById('inv-notes').value.trim(),
            desc:     descArr,
            flags: {
                showInv:  document.getElementById('chk-show-inv').checked,
                showPo:   document.getElementById('chk-show-po').checked,
                showSite: document.getElementById('chk-show-site').checked,
                showDate: true
            }
        }),
        totalAmount:   calculateTotal()
    };
}

document.getElementById('invoice-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    btn.disabled = true;

    try {
        const invoiceData = getInvoiceFormData();

        if (editingId) {
            await API.updateInvoice(editingId, invoiceData);
        } else {
            await API.createInvoice(invoiceData);
        }

        // Fitur Google Calendar via Webhook Make.com (Otomatis di Background)
        try {
            const noteObj = invoiceData.note ? JSON.parse(invoiceData.note) : null;
            if (noteObj && noteObj.type === 'rental' && noteObj.rental && noteObj.rental.awal && noteObj.rental.akhir) {
                const cName = Array.isArray(invoiceData.clientName) ? invoiceData.clientName[0] : invoiceData.clientName;
                
                // --- PENTING: GANTI URL DI BAWAH INI DENGAN WEBHOOK MAKE.COM ANDA ---
                const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/7hi6l7tvede93y853hslvlax68omzcjk';
                const invoiceDocId = invoiceData.$id || '';
                const newRentalUrl = `${window.location.origin}/?rental_from=${invoiceDocId}`;
                
                // Hanya kirim jika URL sudah diisi oleh pengguna
                if (!MAKE_WEBHOOK_URL.includes('xxxxxxxx')) {
                    // Kirim data secara diam-diam di background (tanpa popup)
                    fetch(MAKE_WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            invoiceNo: invoiceData.NoInvoice,
                            clientName: cName,
                            awal: noteObj.rental.awal,
                            akhir: noteObj.rental.akhir,
                            title: `PENGINGAT: Berakhirnya Sewa PBM - ${cName}`,
                            description: `Detail Penyewaan:\n- Nama Klien: ${cName}\n- No. Invoice: ${invoiceData.NoInvoice}\n- Periode: ${noteObj.rental.awal} s/d ${noteObj.rental.akhir}\n\nPengingat:\nMasa sewa untuk invoice ini akan segera berakhir. Harap hubungi klien untuk konfirmasi perpanjangan atau pengembalian barang.\n\n🆕 Buat Invoice Sewa Bulan Baru (klik link ini):\n${newRentalUrl}`
                        })
                    }).catch(err => console.error('Gagal memanggil webhook:', err));
                }
            }
        } catch (e) {
            console.error("Gagal memproses Webhook", e);
        }

        showToast(editingId ? 'Invoice berhasil diperbarui!' : 'Invoice berhasil direkam!', 'success');

        editingId = null;
        statsData = []; // Reset stats cache to force reload
        showDashboard();
    } catch (e) {
        showToast('Gagal menyimpan ke Appwrite: ' + e.message, 'error');
    } finally {
        const resetText = editingId ? 'Perbarui Invoice' : 'Simpan ke Appwrite';
        btn.innerHTML = `<i class="fa-solid fa-save"></i> ${resetText}`;
        btn.disabled = false;
    }
});

function resetForm() {
    document.getElementById('invoice-form').reset();
    document.getElementById('items-container').innerHTML = '';
    itemCount = 0;
    addItemRow();
    document.getElementById('grand-total').textContent = '0';
    document.getElementById('inv-notes').value = '';
    
    // Auto Generate No. INV
    document.getElementById('inv-date').valueAsDate = new Date();
    window.generateInvNumber();
}

window.editInvoice = function(id) {
    const invoice = currentInvoices.find(v => v.$id === id);
    if (!invoice) return;

    editingId = id;
    
    // Determine type
    let invType = 'normal';
    let rentalData = { awal: '', akhir: '' };
    let savedNotes = '';
    let itemsArray = [];
    let flags = { showInv: true, showPo: true, showSite: true, showDate: true };
    let tbArr = [];
    let bgArr = [];
    let descArr = [];

    try {
        const itemObj = typeof invoice.items === 'string' ? JSON.parse(invoice.items) : invoice.items;
        const noteObj = invoice.note ? (typeof invoice.note === 'string' ? JSON.parse(invoice.note) : invoice.note) : null;
        const tbColRaw = invoice.tb ? (typeof invoice.tb === 'string' ? JSON.parse(invoice.tb) : invoice.tb) : null;
        const bgColRaw = invoice.bg ? (typeof invoice.bg === 'string' ? JSON.parse(invoice.bg) : invoice.bg) : null;

        if (noteObj) {
            invType = noteObj.type || 'normal';
            rentalData = noteObj.rental || rentalData;
            savedNotes = noteObj.notes || '';
            flags = noteObj.flags || flags;
            // Prioritas: kolom tb/bg terpisah, fallback ke note.tb/bg (format peralihan)
            tbArr = Array.isArray(tbColRaw) ? tbColRaw : (noteObj.tb || []);
            bgArr = Array.isArray(bgColRaw) ? bgColRaw : (noteObj.bg || []);
            descArr = noteObj.desc || [];
            itemsArray = Array.isArray(itemObj) ? itemObj : [];
        } else {
            invType = itemObj?.type || 'normal';
            rentalData = itemObj?.rental || rentalData;
            savedNotes = itemObj?.notes || '';
            flags = itemObj?.flags || flags;
            if (itemObj && itemObj.itemList) {
                itemsArray = itemObj.itemList;
            } else {
                itemsArray = Array.isArray(itemObj) ? itemObj : [];
            }
        }
    } catch(e) {}

    showCreate(invType); // Switch view and reset form based on type
    editingId = id; // re-set because showCreate resets it
    window.setFormType(invType);
    document.getElementById('submit-btn').innerHTML = '<i class="fa-solid fa-save"></i> Perbarui Invoice';

    // Populate common data
    document.getElementById('inv-notes').value = savedNotes;
    document.getElementById('inv-number').value = invoice.NoInvoice || '';
    document.getElementById('inv-client').value = (Array.isArray(invoice.clientName) ? invoice.clientName[0] : invoice.clientName) || '';
    document.getElementById('inv-wa').value     = invoice.clientAddress || '';
    document.getElementById('inv-po').value     = invoice.noPo || '';
    document.getElementById('inv-site').value   = invoice.site || '';
    document.getElementById('sewa-awal').value  = rentalData.awal || '';
    document.getElementById('sewa-akhir').value = rentalData.akhir || '';
    
    if (invoice.date) {
        document.getElementById('inv-date').value = invoice.date.split('T')[0];
    }

    // Clear and restore items
    document.getElementById('items-container').innerHTML = '';
    itemCount = 0;

    // Re-apply flags from saved data
    document.getElementById('chk-show-inv').checked  = (flags.showInv !== false);
    document.getElementById('chk-show-po').checked   = (flags.showPo !== false);
    document.getElementById('chk-show-site').checked = (flags.showSite !== false);

    if (itemsArray.length > 0) {
        itemsArray.forEach((item, idx) => {
            itemCount++;
            const row = createItemRow(itemCount);
            
            row.querySelector('.item-name').value  = item.name || '';
            row.querySelector('.item-qty').value   = item.qty || 1;
            row.querySelector('.item-price').value = item.price || 0;

            const tbVal = tbArr[idx] !== undefined ? tbArr[idx] : item.tb;
            const bgVal = bgArr[idx] !== undefined ? bgArr[idx] : item.bg;
            const descVal = descArr[idx] !== undefined ? descArr[idx] : item.desc;

            row.querySelector('.item-tb').value    = (tbVal && tbVal !== "NO-ENTRY") ? tbVal : '';
            row.querySelector('.item-bg').value    = (bgVal && bgVal !== "NO-ENTRY") ? bgVal : '';
            if(row.querySelector('.item-desc')) row.querySelector('.item-desc').value = descVal || '';
            
            document.getElementById('items-container').appendChild(row);
        });
    } else {
        addItemRow();
    }
    
    calculateTotal();
}

window.createRentalForThisMonth = function(id) {
    const invoice = currentInvoices.find(v => v.$id === id);
    if (!invoice) return;

    let savedNotes = '';
    let itemsArray = [];
    let descArr = [];

    try {
        const itemObj = typeof invoice.items === 'string' ? JSON.parse(invoice.items) : invoice.items;
        const noteObj = invoice.note ? (typeof invoice.note === 'string' ? JSON.parse(invoice.note) : invoice.note) : null;

        if (noteObj) {
            savedNotes = noteObj.notes || '';
            descArr = noteObj.desc || [];
            itemsArray = Array.isArray(itemObj) ? itemObj : [];
        } else {
            savedNotes = itemObj?.notes || '';
            if (itemObj && itemObj.itemList) {
                itemsArray = itemObj.itemList;
            } else {
                itemsArray = Array.isArray(itemObj) ? itemObj : [];
            }
        }
    } catch(e) {}

    // Open form in rental create mode (editingId stays null for new invoice creation)
    showCreate('rental');

    document.getElementById('form-title').textContent = 'Buat Invoice Sewa (Bulan Ini)';

    // Populate client & basic data
    document.getElementById('inv-client').value = (Array.isArray(invoice.clientName) ? invoice.clientName[0] : invoice.clientName) || '';
    document.getElementById('inv-wa').value     = invoice.clientAddress || '';
    document.getElementById('inv-notes').value  = savedNotes;

    // Calculate dates for CURRENT MONTH
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth(); // 0-indexed
    
    // Set invoice date to today
    document.getElementById('inv-date').value = now.toISOString().split('T')[0];

    // Determine day of month from original rental date if available, or default to day 1
    let originalDay = 1;
    try {
        const noteObj = invoice.note ? (typeof invoice.note === 'string' ? JSON.parse(invoice.note) : invoice.note) : null;
        if (noteObj && noteObj.rental && noteObj.rental.awal) {
            const origDate = new Date(noteObj.rental.awal);
            if (!isNaN(origDate.getTime())) {
                originalDay = origDate.getDate();
            }
        }
    } catch(e) {}

    // Ensure day does not exceed max days in current month
    const maxDays = new Date(curYear, curMonth + 1, 0).getDate();
    const startDay = Math.min(originalDay, maxDays);
    
    const startDateObj = new Date(curYear, curMonth, startDay);
    const endDateObj = new Date(curYear, curMonth + 1, startDay);

    const formatISO = (d) => {
        const y = d.getFullYear();
        const m = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    document.getElementById('sewa-awal').value  = formatISO(startDateObj);
    document.getElementById('sewa-akhir').value = formatISO(endDateObj);

    // Populate items
    document.getElementById('items-container').innerHTML = '';
    itemCount = 0;

    if (itemsArray.length > 0) {
        itemsArray.forEach((item, idx) => {
            itemCount++;
            const row = createItemRow(itemCount);
            
            row.querySelector('.item-name').value  = item.name || '';
            row.querySelector('.item-qty').value   = item.qty || 1;
            row.querySelector('.item-price').value = item.price || 0;

            const descVal = descArr[idx] !== undefined ? descArr[idx] : item.desc;
            if (row.querySelector('.item-desc')) row.querySelector('.item-desc').value = descVal || '';
            
            document.getElementById('items-container').appendChild(row);
        });
    } else {
        addItemRow();
    }
    
    calculateTotal();
}

window.deleteInvoice = async function(id) {
    const confirmed = await showConfirm('Hapus Invoice', 'Data invoice ini akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan.', { type: 'danger', confirmText: 'Ya, Hapus', icon: 'fa-trash-can' });
    if(confirmed) {
        try {
            await API.deleteInvoice(id);
            showToast('Invoice berhasil dihapus', 'success');
            statsData = [];
            loadInvoices(currentPage);
        } catch(e) {
            showToast('Gagal menghapus: ' + e.message, 'error');
        }
    }
}

window.updatePaymentStatus = async function(id, newStatus) {
    try {
        await API.updateInvoiceStatus(id, newStatus);
        showToast('Status pembayaran diperbarui', 'success');
    } catch (e) {
        showToast('Gagal mengupdate status: ' + e.message, 'error');
        loadInvoices(); // reload to reset the select to previous state
    }
}

window.downloadPDF = async function(id) {
    const invoice = currentInvoices.find(inv => inv.$id === id) || 
                    statsData.find(inv => inv.$id === id) || 
                    (searchFilteredData && searchFilteredData.find(inv => inv.$id === id));
    if(invoice) {
        try {
            await window.generatePDF(invoice, 'download');
            if (invoice.paymentStatus === 'pending') {
                updatePaymentStatus(id, 'paid');
            }
        } catch (e) {
            console.error("Download PDF Error:", e);
            showToast('Gagal mengunduh PDF: ' + e.message, 'error');
        }
    } else {
        showToast('Data invoice tidak ditemukan.', 'warning');
    }
}

window.nativeShare = async function(id) {
    const invoice = currentInvoices.find(inv => inv.$id === id) || 
                    statsData.find(inv => inv.$id === id) || 
                    (searchFilteredData && searchFilteredData.find(inv => inv.$id === id));
    if(!invoice) return;
    
    try {
        const { blob, title } = await window.generatePDF(invoice, 'share');
        const file = new File([blob], title, { type: 'application/pdf' });
        
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: 'Invoice / Tagihan ' + invoice.NoInvoice,
                text: 'Berikut adalah dokumen cetak tagihan (Invoice) terlampir.'
            });
            
            if (invoice.paymentStatus === 'pending') {
                updatePaymentStatus(id, 'paid');
            }
        } else {
            showToast('Browser/Ponsel Anda tidak mendukung share file PDF. Mengunduh file...', 'warning');
            await window.generatePDF(invoice, 'download');
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            showToast('Gagal membagikan dokumen: ' + e.message, 'error');
        }
    }
}

// Deteksi perangkat mobile (Android / iOS)
function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

window.previewInvoice = async function() {
    const data = getInvoiceFormData();
    const btn = document.getElementById('preview-btn');
    const originalText = btn.innerHTML;
    
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
    btn.disabled = true;
    
    try {
        const blobUrl = await window.generatePDF(data, 'preview');

        if (isMobileDevice()) {
            // Android/iOS: iframe tidak support blob PDF — buka di tab baru
            const newTab = window.open(blobUrl, '_blank');
            // Jika popup diblokir browser, fallback ke download langsung
            if (!newTab) {
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = `${data.noInvoice || 'invoice'}.pdf`;
                a.click();
            }
        } else {
            // Desktop: tampilkan di modal iframe seperti biasa
            document.getElementById('preview-iframe').src = blobUrl;
            document.getElementById('preview-modal').style.display = 'flex';
        }
    } catch (e) {
        showToast('Gagal membuat pratinjau: ' + e.message, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

window.closePreview = function() {
    const modal = document.getElementById('preview-modal');
    const iframe = document.getElementById('preview-iframe');
    
    // Revoke the URL to free memory
    if (iframe.src.startsWith('blob:')) {
        URL.revokeObjectURL(iframe.src);
    }
    
    iframe.src = '';
    modal.style.display = 'none';
}

window.downloadPreview = async function() {
    const iframe = document.getElementById('preview-iframe');
    if (iframe.src.startsWith('blob:')) {
        const data = getInvoiceFormData();
        await window.generatePDF(data, 'download'); // Trigger actual download
    }
}

// Auth Flow
window.handleLogin = async function(e) {
    if (e) e.preventDefault();
    const btn = document.querySelector('#login-form button');
    const err = document.getElementById('login-error');
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
    btn.disabled = true;
    err.style.display = 'none';

    try {
        await API.login(email, pass);
        // Success
        document.getElementById('view-login').style.display = 'none';
        document.querySelector('.app-container').style.display = 'flex';
        initAndLoad();
    } catch (error) {
        err.style.display = 'block';
        err.textContent = 'Login gagal: ' + error.message;
    } finally {
        btn.innerHTML = 'Masuk <i class="fa-solid fa-arrow-right-to-bracket"></i>';
        btn.disabled = false;
    }
};

window.handleLogout = async function() {
    const confirmed = await showConfirm('Keluar', 'Anda yakin ingin keluar dari akun ini?', { type: 'warning', confirmText: 'Ya, Keluar', icon: 'fa-right-from-bracket' });
    if (confirmed) {
        try {
            await API.logout();
            window.location.reload();
        } catch (e) {
            showToast('Gagal logout: ' + e.message, 'error');
        }
    }
};

async function initAndLoad() {
    // Sesuaikan label tombol pratinjau berdasarkan perangkat
    const labelEl = document.getElementById('preview-btn-label');
    if (labelEl && isMobileDevice()) {
        labelEl.textContent = 'Buka PDF';
    }

    // Deep-link handling dari Google Calendar (Make.com webhook)
    const urlParams = new URLSearchParams(window.location.search);
    const rentalFromId = urlParams.get('rental_from');

    if (rentalFromId) {
        // Bersihkan URL agar bersih
        history.replaceState({}, '', window.location.pathname);
        // Load semua data terlebih dahulu (termasuk statsData), lalu buka form sewa dengan data invoice sumber
        await loadInvoices(1);
        // Cari invoice di currentInvoices atau statsData
        const srcInvoice = currentInvoices.find(v => v.$id === rentalFromId)
                        || statsData.find(v => v.$id === rentalFromId);
        if (srcInvoice) {
            window.createRentalForThisMonth(srcInvoice.$id);
        } else {
            // Jika tidak ditemukan di cache, fetch langsung dari API
            try {
                const fetched = await API.getInvoice(rentalFromId);
                if (fetched) {
                    currentInvoices = [fetched, ...currentInvoices];
                    window.createRentalForThisMonth(fetched.$id);
                } else {
                    showCreate('rental');
                }
            } catch(e) {
                showCreate('rental');
            }
        }
    } else {
        loadInvoices(1);
    }
}



// Boot up
window.addEventListener('DOMContentLoaded', async () => {
    // Setup listeners
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', window.handleLogin);
    
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.addEventListener('click', window.handleLogout);

    // Make brand logos clickable to redirect to Dashboard
    document.querySelectorAll('.brand, .mobile-brand').forEach(el => {
        // Exclude the login screen brand just in case
        if (!el.classList.contains('login-brand')) {
            el.addEventListener('click', () => { 
                switchView('dashboard'); 
                loadInvoices(1); 
            });
        }
    });

    // Mobile Sidebar Setup
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const overlay = document.getElementById('sidebar-overlay');
    const sidebar = document.getElementById('sidebar');

    if (mobileBtn && overlay && sidebar) {
        mobileBtn.addEventListener('click', () => {
            sidebar.classList.toggle('active');
            overlay.classList.toggle('active');
        });
        overlay.addEventListener('click', closeMobileSidebar);
    }

    // Initial session check
    try {
        const session = await API.getSession();
        if (session) {
            // Already logged in
            document.getElementById('view-login').style.display = 'none';
            document.querySelector('.app-container').style.display = 'flex';
            initAndLoad();
        } else {
            // Wait for user to login
            document.getElementById('view-login').style.display = 'flex';
        }
    } catch (e) {
        console.log("Session not found or error:", e);
    }

    
    document.getElementById('inv-date').addEventListener('change', () => {
        if (!editingId && !document.getElementById('inv-number').value.includes('-')) {
            window.generateInvNumber();
        }
    });

    document.getElementById('sewa-awal').addEventListener('change', (e) => {
        if (e.target.value) {
            const date = new Date(e.target.value);
            date.setMonth(date.getMonth() + 1);
            document.getElementById('sewa-akhir').value = date.toISOString().split('T')[0];
        }
    });

    const notesEl = document.getElementById('inv-notes');
    if (notesEl) {
        notesEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                const type = document.getElementById('inv-type').value;
                if (type === 'rental') {
                    const cursorPosition = this.selectionStart;
                    const textBefore = this.value.substring(0, cursorPosition);
                    const textAfter  = this.value.substring(cursorPosition);
                    
                    const lines = textBefore.split('\n');
                    const currentLine = lines[lines.length - 1];
                    
                    const match = currentLine.match(/^(\d+)\.\s/);
                    if (match) {
                        e.preventDefault(); // Prevent standard enter
                        if (currentLine.trim() === match[0].trim()) {
                            // User pressed enter on an empty numbered line -> stop numbering
                            lines[lines.length - 1] = '';
                            this.value = lines.join('\n') + '\n' + textAfter;
                            this.selectionStart = this.selectionEnd = cursorPosition - match[0].length + 1;
                        } else {
                            // Increment number
                            const nextNumber = parseInt(match[1], 10) + 1;
                            const insertText = '\n' + nextNumber + '. ';
                            this.value = textBefore + insertText + textAfter;
                            this.selectionStart = this.selectionEnd = cursorPosition + insertText.length;
                        }
                    }
                }
            }
        });
    }
});

window.generateInvNumber = function(prefix) {
    const dateInput = document.getElementById('inv-date').value;
    const dateObj = dateInput ? new Date(dateInput) : new Date();
    const prefixStr = prefix || (document.getElementById('inv-type').value === 'rental' ? 'SW' : 'INV');
    const yStr = dateObj.getFullYear();
    const mStr = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const rand4 = Math.floor(Math.random() * 9000) + 1000;
    document.getElementById('inv-number').value = `${prefixStr}${yStr}${mStr}${rand4}`;
};

window.handlePdfScan = async function(input) {
    const file = input.files[0];
    if (!file) return;

    const overlay = document.getElementById('scanning-overlay');
    const mainText = document.getElementById('scan-main-text');
    const subText = document.getElementById('scan-sub-text');
    
    overlay.style.display = 'flex';
    mainText.textContent = 'Membaca File PDF...';
    subText.textContent = 'Mengekstrak teks menggunakan unpdf';

    const progressTimeouts = [
        setTimeout(() => {
            if(overlay.style.display !== 'none') {
                mainText.textContent = 'Menghubungkan ke Gemini AI...';
                subText.textContent = 'Mengirim data ke server Google';
            }
        }, 1500),
        setTimeout(() => {
            if(overlay.style.display !== 'none') {
                mainText.textContent = 'Gemini sedang menganalisis...';
                subText.textContent = 'Mengekstrak nama klien, alamat, dan tabel barang';
            }
        }, 3500),
        setTimeout(() => {
            if(overlay.style.display !== 'none') {
                mainText.textContent = 'Memformat Data...';
                subText.textContent = 'Mengonversi hasil ke struktur JSON (Structured Output)';
            }
        }, 6000)
    ];

    try {
        const formData = new FormData();
        formData.append('file', file);

        // Frontend & backend digabung, gunakan path relatif
        const apiUrl = '/api/scan-pdf';

        const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        if (!response.ok) {
            if (result.retryAfter) {
                // Server told us exactly how long to wait
                showNextJsError(`Rate limit Gemini. Tunggu ${result.retryAfter} sebelum mencoba lagi.`);
            } else {
                throw new Error(result.error || 'Gagal menganalisis PDF');
            }
            return;
        }

        const data = result.data;

        // Reset form and set type FIRST before populating fields
        if (data.type) {
            showCreate(data.type);
            highlightField('form-title');
        }

        // Populate the form (NoInvoice is intentionally skipped so it keeps the website's original auto-generated number)
        if (data.clientName) {
            document.getElementById('inv-client').value = data.clientName;
            highlightField('inv-client');
        }
        if (data.clientAddress) {
            document.getElementById('inv-wa').value = data.clientAddress;
            highlightField('inv-wa');
        }
        if (data.noPo) {
            document.getElementById('inv-po').value = data.noPo;
            highlightField('inv-po');
        }
        if (data.site) {
            document.getElementById('inv-site').value = data.site;
            highlightField('inv-site');
        }
        if (data.date) {
            document.getElementById('inv-date').value = data.date.split('T')[0];
            highlightField('inv-date');
        }
        if (data.notes) {
            document.getElementById('inv-notes').value = data.notes;
            highlightField('inv-notes');
        }

        // Handle items
        if (data.items && Array.isArray(data.items)) {
            document.getElementById('items-container').innerHTML = '';
            itemCount = 0;
            data.items.forEach(item => {
                itemCount++;
                const row = createItemRow(itemCount);
                row.querySelector('.item-name').value = item.name || '';
                row.querySelector('.item-qty').value = item.qty || 1;
                row.querySelector('.item-price').value = item.price || 0;
                if (item.tb) row.querySelector('.item-tb').value = item.tb;
                if (item.bg) row.querySelector('.item-bg').value = item.bg;
                if (item.desc) row.querySelector('.item-desc').value = item.desc;
                document.getElementById('items-container').appendChild(row);
                row.classList.add('scan-highlight');
            });
            calculateTotal();
        }

        showToast('AI berhasil mengekstrak data! Silakan tinjau kembali sebelum menyimpan.', 'success');

    } catch (error) {
        console.error('Scan Error:', error);
        
        let errorMsg = error.message;
        if (errorMsg.includes('Failed to fetch')) {
            errorMsg = "Server tidak merespon. Pastikan server backend Next.js berjalan.";
        } else if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
            errorMsg = "Gemini AI terlalu banyak permintaan. Tunggu 30 detik dan coba lagi.";
        }
        
        showToast(errorMsg, 'error', 8000);
    } finally {
        progressTimeouts.forEach(clearTimeout);
        overlay.style.display = 'none';
        input.value = ''; // Reset input
    }
};

function highlightField(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.add('scan-highlight');
        setTimeout(() => el.classList.remove('scan-highlight'), 3000);
    }
}

// showNextJsError telah digantikan oleh showToast(message, 'error', duration)

/* ==========================================================================
   Business Health Analytics Engine
   ========================================================================== */

window.setAnalyticsRange = function(months) {
    analyticsRangeMonths = months;
    
    // Update active button state
    document.querySelectorAll('.analytics-range-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.includes(months + ' Bulan')) {
            btn.classList.add('active');
        }
    });

    renderAnalyticsDashboard();
}

function renderAnalyticsDashboard(docsTarget) {
    const docs = docsTarget || (statsData.length > 0 ? statsData : currentInvoices);
    if (!docs || docs.length === 0) return;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // 1. Calculate KPI Metrics
    let totalYtd = 0;
    let totalThisMonth = 0;
    let totalLastMonth = 0;
    let paidCount = 0;
    
    const clientFirstDates = {}; // clientName -> earliest Date
    const clientTotals = {};     // clientName -> { total: number, count: number }
    const typeCounts = { rental: 0, normal: 0 };
    const paymentCounts = { paid: 0, pending: 0, overdue: 0 };

    docs.forEach(inv => {
        const invDate = new Date(inv.date || inv.$createdAt);
        const amount = Number(inv.totalAmount) || 0;
        const cName = Array.isArray(inv.clientName) ? inv.clientName[0] : (inv.clientName || 'Tidak Diketahui');
        
        // Check Type
        let isRental = false;
        try {
            const data = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items;
            const noteData = inv.note ? (typeof inv.note === 'string' ? JSON.parse(inv.note) : inv.note) : null;
            isRental = (noteData && noteData.type === 'rental') || 
                       (data && data.type === 'rental') || 
                       (inv.NoInvoice && String(inv.NoInvoice).toUpperCase().startsWith('SW')) ||
                       Boolean(noteData && noteData.rental && (noteData.rental.awal || noteData.rental.akhir));
        } catch(e) {}

        if (isRental) typeCounts.rental++;
        else typeCounts.normal++;

        // Check Payment Status
        const status = (inv.paymentStatus || 'pending').toLowerCase();
        if (status === 'paid') {
            paymentCounts.paid++;
            paidCount++;
        } else if (status === 'overdue') {
            paymentCounts.overdue++;
        } else {
            paymentCounts.pending++;
        }

        // YTD & Monthly Totals
        if (invDate.getFullYear() === currentYear) {
            totalYtd += amount;
        }

        if (invDate.getFullYear() === currentYear && invDate.getMonth() === currentMonth) {
            totalThisMonth += amount;
        }

        // Last Month calculation for delta
        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        if (invDate.getFullYear() === lastMonthDate.getFullYear() && invDate.getMonth() === lastMonthDate.getMonth()) {
            totalLastMonth += amount;
        }

        // Client Aggregation
        if (!clientTotals[cName]) {
            clientTotals[cName] = { total: 0, count: 0 };
        }
        clientTotals[cName].total += amount;
        clientTotals[cName].count += 1;

        // Track Earliest Date per Client
        if (!clientFirstDates[cName] || invDate < clientFirstDates[cName]) {
            clientFirstDates[cName] = invDate;
        }
    });

    // 2. Render KPI Cards
    const ytdEl = document.getElementById('analytics-kpi-ytd');
    if (ytdEl) ytdEl.textContent = 'Rp ' + totalYtd.toLocaleString('id-ID');

    const monthEl = document.getElementById('analytics-kpi-month');
    if (monthEl) monthEl.textContent = 'Rp ' + totalThisMonth.toLocaleString('id-ID');

    // Monthly Delta
    const monthChangeEl = document.getElementById('analytics-kpi-month-change');
    if (monthChangeEl) {
        if (totalLastMonth > 0) {
            const pct = Math.round(((totalThisMonth - totalLastMonth) / totalLastMonth) * 100);
            const isUp = pct >= 0;
            monthChangeEl.className = `kpi-change ${isUp ? 'up' : 'down'}`;
            monthChangeEl.innerHTML = `<i class="fa-solid fa-arrow-${isUp ? 'up' : 'down'}"></i> ${Math.abs(pct)}% vs bln lalu`;
        } else {
            monthChangeEl.className = 'kpi-change neutral';
            monthChangeEl.innerHTML = '<i class="fa-solid fa-minus"></i> 0% vs bln lalu';
        }
    }

    // Paid Rate
    const totalDocs = docs.length;
    const paidRatePct = totalDocs > 0 ? Math.round((paidCount / totalDocs) * 100) : 0;
    const paidRateEl = document.getElementById('analytics-kpi-paid-rate');
    if (paidRateEl) paidRateEl.textContent = paidRatePct + '%';
    
    const paidCountEl = document.getElementById('analytics-kpi-paid-count');
    if (paidCountEl) paidCountEl.textContent = `${paidCount} dari ${totalDocs} invoice lunas`;

    // Active Clients & New Clients (30 days)
    const activeClientsCount = Object.keys(clientTotals).length;
    const activeClientsEl = document.getElementById('analytics-kpi-active-clients');
    if (activeClientsEl) activeClientsEl.textContent = activeClientsCount;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const newClients = Object.entries(clientFirstDates)
        .filter(([_, firstDate]) => firstDate >= thirtyDaysAgo)
        .map(([name, firstDate]) => ({ name, date: firstDate, amount: clientTotals[name]?.total || 0 }));

    const newClientsCountEl = document.getElementById('analytics-kpi-new-clients-count');
    if (newClientsCountEl) newClientsCountEl.textContent = `${newClients.length} pelanggan baru (30hr)`;

    // 3. Render Charts
    renderRevenueTrendChart(docs, analyticsRangeMonths);
    renderTypeDonutChart(typeCounts);
    renderPaymentDonutChart(paymentCounts);

    // 4. Render Lists (Top Clients & New Clients)
    renderTopClientsList(clientTotals);
    renderNewClientsList(newClients);
}

// Chart 1: Revenue Trend Bar Chart
function renderRevenueTrendChart(docs, monthsToShow = 6) {
    const canvas = document.getElementById('chart-revenue-trend');
    if (!canvas || typeof Chart === 'undefined') return;

    const now = new Date();
    const monthLabels = [];
    const monthlyTotals = Array(monthsToShow).fill(0);

    for (let i = monthsToShow - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthLabels.push(d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }));
    }

    docs.forEach(inv => {
        const invDate = new Date(inv.date || inv.$createdAt);
        const amount = Number(inv.totalAmount) || 0;

        for (let i = 0; i < monthsToShow; i++) {
            const targetDate = new Date(now.getFullYear(), now.getMonth() - (monthsToShow - 1 - i), 1);
            if (invDate.getFullYear() === targetDate.getFullYear() && invDate.getMonth() === targetDate.getMonth()) {
                monthlyTotals[i] += amount;
                break;
            }
        }
    });

    if (revenueChart) {
        revenueChart.destroy();
    }

    const ctx = canvas.getContext('2d');
    revenueChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: monthLabels,
            datasets: [{
                label: 'Pendapatan (Rp)',
                data: monthlyTotals,
                backgroundColor: 'rgba(99, 102, 241, 0.75)',
                borderColor: '#6366f1',
                borderWidth: 2,
                borderRadius: 6,
                hoverBackgroundColor: 'rgba(99, 102, 241, 0.95)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return 'Pendapatan: Rp ' + Number(context.raw).toLocaleString('id-ID');
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#9ca3af',
                        callback: function(val) {
                            if (val >= 1000000) return (val / 1000000) + ' Jt';
                            if (val >= 1000) return (val / 1000) + ' Rb';
                            return val;
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#9ca3af' }
                }
            }
        }
    });
}

// Chart 2: Type Composition Donut
function renderTypeDonutChart(typeCounts) {
    const canvas = document.getElementById('chart-type-donut');
    if (!canvas || typeof Chart === 'undefined') return;

    if (typeChart) {
        typeChart.destroy();
    }

    const ctx = canvas.getContext('2d');
    typeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Invoice Reguler', 'Invoice Sewa'],
            datasets: [{
                data: [typeCounts.normal, typeCounts.rental],
                backgroundColor: ['#6366f1', '#ec4899'],
                borderColor: 'var(--surface)',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#9ca3af', font: { size: 12 } }
                }
            },
            cutout: '70%'
        }
    });
}

// Chart 3: Payment Status Donut
function renderPaymentDonutChart(paymentCounts) {
    const canvas = document.getElementById('chart-payment-donut');
    if (!canvas || typeof Chart === 'undefined') return;

    if (paymentChart) {
        paymentChart.destroy();
    }

    const ctx = canvas.getContext('2d');
    paymentChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Lunas (Paid)', 'Menunggu (Pending)', 'Jatuh Tempo (Overdue)'],
            datasets: [{
                data: [paymentCounts.paid, paymentCounts.pending, paymentCounts.overdue],
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                borderColor: 'var(--surface)',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#9ca3af', font: { size: 12 } }
                }
            },
            cutout: '70%'
        }
    });
}

// List 1: Top 5 Active Clients
function renderTopClientsList(clientTotals) {
    const container = document.getElementById('analytics-top-clients');
    if (!container) return;

    const sortedClients = Object.entries(clientTotals)
        .map(([name, data]) => ({ name, total: data.total, count: data.count }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

    if (sortedClients.length === 0) {
        container.innerHTML = '<div class="empty-analytics text-muted">Belum ada data pelanggan</div>';
        return;
    }

    const maxTotal = sortedClients[0].total || 1;

    container.innerHTML = sortedClients.map((client, idx) => {
        const pct = Math.round((client.total / maxTotal) * 100);
        return `
            <div class="top-client-item">
                <div class="top-client-rank rank-${idx + 1}">${idx + 1}</div>
                <div class="top-client-info">
                    <div class="top-client-name" title="${client.name}">${client.name}</div>
                    <div class="top-client-bar-bg">
                        <div class="top-client-bar-fill" style="width: ${pct}%;"></div>
                    </div>
                </div>
                <div class="top-client-meta">
                    <div class="top-client-amount">Rp ${client.total.toLocaleString('id-ID')}</div>
                    <div class="top-client-count">${client.count} Invoice</div>
                </div>
            </div>
        `;
    }).join('');
}

// List 2: New Clients (30 days)
function renderNewClientsList(newClients) {
    const container = document.getElementById('analytics-new-clients');
    if (!container) return;

    if (newClients.length === 0) {
        container.innerHTML = '<div class="empty-analytics text-muted"><i class="fa-solid fa-user-check"></i> Tidak ada pelanggan baru dalam 30 hari terakhir.</div>';
        return;
    }

    container.innerHTML = newClients.map(c => `
        <div class="new-client-item">
            <div class="new-client-details">
                <span class="badge-new-client">BARU</span>
                <div>
                    <div class="new-client-name">${c.name}</div>
                    <div class="new-client-date"><i class="fa-solid fa-clock-rotate-left"></i> Bergabung: ${c.date.toLocaleDateString('id-ID')}</div>
                </div>
            </div>
            <div class="top-client-amount" style="font-size:12px;">
                Rp ${c.amount.toLocaleString('id-ID')}
            </div>
        </div>
    `).join('');
}

