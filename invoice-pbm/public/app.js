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
let currentSortBy = '$createdAt';
let currentSortDir = 'desc';
let currentTypeFilter = 'all';
let isPrivacyMode = localStorage.getItem('pbm_privacy_mode') === 'true';

window.formatRupiah = function(amount, prefix = 'Rp ') {
    if (isPrivacyMode) {
        return (prefix || '') + '***.***.***';
    }
    const num = Number(amount) || 0;
    return (prefix || '') + num.toLocaleString('id-ID');
};

window.togglePrivacyMode = function() {
    isPrivacyMode = !isPrivacyMode;
    try { localStorage.setItem('pbm_privacy_mode', isPrivacyMode ? 'true' : 'false'); } catch {}
    updatePrivacyUI();
    
    // Fast in-memory UI re-render (instant response, 0ms latency)
    updateStats();
    renderInvoiceTable();
    
    // Update create form total if visible
    const createView = document.getElementById('view-create');
    if (createView && createView.style.display !== 'none' && typeof calculateTotal === 'function') {
        calculateTotal();
    }

    // Update analytics if visible (skip chart animation for instant 0ms response)
    const analyticsView = document.getElementById('view-analytics');
    if (analyticsView && analyticsView.style.display !== 'none' && typeof renderAnalyticsDashboard === 'function') {
        renderAnalyticsDashboard(null, true);
    }
    
    notify(isPrivacyMode ? 'Sensor Nominal Uang AKTIF' : 'Sensor Nominal Uang NONAKTIF', 'info');
};

window.updatePrivacyUI = function() {
    const btn = document.getElementById('privacy-toggle-btn');
    const icon = document.getElementById('privacy-toggle-icon');
    const text = document.getElementById('privacy-toggle-text');
    if (!btn || !icon || !text) return;
    if (isPrivacyMode) {
        icon.className = 'fa-solid fa-eye-slash';
        text.textContent = 'Sensor: On';
        btn.classList.add('btn-warning');
        btn.classList.remove('btn-outline');
        btn.style.background = 'rgba(245, 158, 11, 0.2)';
        btn.style.borderColor = '#f59e0b';
        btn.style.color = '#fbbf24';
    } else {
        icon.className = 'fa-solid fa-eye';
        text.textContent = 'Sensor: Off';
        btn.classList.remove('btn-warning');
        btn.classList.add('btn-outline');
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
    }
};

// ══════════════════════════════════════════════════════
//  ACTIVITY LOG MODULE
// ══════════════════════════════════════════════════════
const ActivityLog = {
    MAX: 200,
    KEY: 'pbm_activity_log',
    USER_KEY: 'pbm_current_user',
    _filter: 'all',

    // Kategori per action type
    _categories: {
        create_invoice: 'invoice', edit_invoice: 'invoice',
        delete_invoice: 'invoice', update_status: 'invoice',
        download_pdf: 'pdf', share_pdf: 'pdf',
        login: 'auth', logout: 'auth',
        notif_open_form: 'invoice'
    },

    // Ikon per action type
    _icons: {
        create_invoice: { cls: 'create',  fa: 'fa-plus-circle' },
        edit_invoice:   { cls: 'edit',    fa: 'fa-pen-to-square' },
        delete_invoice: { cls: 'delete',  fa: 'fa-trash-can' },
        update_status:  { cls: 'status',  fa: 'fa-circle-check' },
        download_pdf:   { cls: 'pdf',     fa: 'fa-file-pdf' },
        share_pdf:      { cls: 'share',   fa: 'fa-share-nodes' },
        login:          { cls: 'login',   fa: 'fa-right-to-bracket' },
        logout:         { cls: 'logout',  fa: 'fa-right-from-bracket' },
        notif_open_form:{ cls: 'notif',   fa: 'fa-bell' }
    },

    /** Simpan user saat ini ke memory + localStorage */
    setUser(email, name) {
        const user = { email: email || '', name: name || email || 'Unknown' };
        try { localStorage.setItem(this.USER_KEY, JSON.stringify(user)); } catch {}
        this._user = user;
        // Update UI di header jika ada
        const el = document.getElementById('current-user-display');
        if (el) el.textContent = user.name || user.email;
    },

    /** Ambil user saat ini */
    getUser() {
        if (this._user) return this._user;
        try {
            const u = JSON.parse(localStorage.getItem(this.USER_KEY) || 'null');
            if (u) { this._user = u; return u; }
        } catch {}
        return { email: '', name: 'Unknown' };
    },

    /** Hapus user (saat logout) */
    clearUser() {
        this._user = null;
        try { localStorage.removeItem(this.USER_KEY); } catch {}
    },

    /** Tambah log baru — simpan ke localStorage dulu (instant), lalu push ke Appwrite */
    add(action, label, detail = '', meta = {}) {
        const user = this.getUser();
        const entry = {
            id: Date.now() + Math.random().toString(36).slice(2),
            action,
            label,
            detail,
            user: user.name || user.email || 'Unknown',
            userEmail: user.email || '',
            invoiceId: meta.invoiceId || '',
            snapshot:  meta.snapshot  || '',
            ts: Date.now()
        };

        // 1. Simpan ke localStorage cache dulu (instant)
        const cached = this._getCache();
        cached.unshift(entry);
        if (cached.length > this.MAX) cached.splice(this.MAX);
        this._setCache(cached);
        this._updateBadge(cached);

        // Re-render jika panel terbuka
        const panel = document.getElementById('activity-panel');
        if (panel && panel.classList.contains('open')) this._renderEntries(cached);

        // 2. Push ke Appwrite di background (non-blocking)
        API.addLog({
            action:    entry.action,
            label:     entry.label,
            detail:    entry.detail || '',
            user:      entry.user,
            userEmail: entry.userEmail,
            invoiceId: entry.invoiceId,
            snapshot:  entry.snapshot,
            ts:        entry.ts
        }).catch(() => {}); // Abaikan error agar tidak ganggu UI
    },

    /** Buat snapshot ringkas dari invoice (hanya field penting) */
    makeSnapshot(invoice) {
        const FIELDS = ['NoInvoice','clientName','clientAddress','noPo','site','date',
                        'items','note','tb','bg','totalAmount','paymentStatus'];
        const snap = {};
        FIELDS.forEach(f => { if (invoice[f] !== undefined) snap[f] = invoice[f]; });
        try { return JSON.stringify(snap); } catch { return ''; }
    },

    /** Pulihkan invoice dari snapshot atau ID */
    async restore(entry) {
        let invNo = '';
        if (entry.label) {
            const match = entry.label.match(/(INV-[^\s]+|SW-[^\s]+|Invoice\s+[^\s]+)/i);
            if (match) invNo = match[0];
        }

        // 1. Jika log memiliki data snapshot (full data backup)
        if (entry.snapshot) {
            try {
                const data = JSON.parse(entry.snapshot);
                invNo = data.NoInvoice || invNo || 'Invoice';

                const actionTitle = entry.action === 'edit_invoice' ? 'Kembalikan Versi Invoice' : 'Pulihkan Invoice';
                const actionMsg = entry.action === 'edit_invoice'
                    ? `Apakah Anda yakin ingin mengembalikan ${invNo} ke versi sebelum diedit?`
                    : `Apakah Anda yakin ingin memulihkan data ${invNo} ke database?`;

                const confirmed = await showConfirm(
                    actionTitle,
                    actionMsg,
                    { type: 'warning', confirmText: 'Ya, Pulihkan', icon: 'fa-rotate-left' }
                );
                if (!confirmed) return;

                delete data.$id;
                delete data.$collectionId;
                delete data.$databaseId;
                delete data.$createdAt;
                delete data.$updatedAt;

                let restored = false;
                if (entry.invoiceId) {
                    try {
                        await API.updateInvoice(entry.invoiceId, data);
                        restored = true;
                        notify(`Invoice ${invNo} berhasil dikembalikan ke versi sebelumnya!`, 'success');
                        ActivityLog.add('edit_invoice', `Invoice ${invNo} dipulihkan dari log`, `Klien: ${Array.isArray(data.clientName) ? data.clientName[0] : data.clientName}`);
                    } catch (err) {}
                }
                if (!restored) {
                    await API.createInvoice(data);
                    notify(`Invoice ${invNo} berhasil dipulihkan!`, 'success');
                    ActivityLog.add('create_invoice', `Invoice ${invNo} dipulihkan dari log`, `Klien: ${Array.isArray(data.clientName) ? data.clientName[0] : data.clientName}`);
                }

                statsData = [];
                loadInvoices(currentPage);
                return;
            } catch (e) {
                console.error("Gagal parse snapshot log", e);
            }
        }

        // 2. Jika snapshot tidak ada (misal log lama sebelum ada snapshot), tetapi invoiceId / data invoice ada di DB
        if (entry.invoiceId) {
            const target = currentInvoices.find(v => v.$id === entry.invoiceId) || statsData.find(v => v.$id === entry.invoiceId);
            if (target) {
                const confirmed = await showConfirm(
                    'Buka & Edit Invoice',
                    `Invoice ${target.NoInvoice || ''} saat ini ada di database. Ingin membuka form edit untuk menyesuaikan datanya?`,
                    { type: 'warning', confirmText: 'Buka Form Edit', icon: 'fa-pen-to-square' }
                );
                if (confirmed) {
                    toggleActivityPanel(false);
                    editInvoice(entry.invoiceId);
                }
                return;
            }
        }

        // 3. Jika snapshot log lama kosong & invoice sudah terhapus permanen
        notify('Log aktivitas lama ini belum memiliki backup snapshot. Fitur pemulihan otomatis aktif untuk semua aktivitas invoice yang dicatat baru!', 'warning');
    },

    /** Ambil dari localStorage cache (cepat, untuk badge) */
    getAll() { return this._getCache(); },

    /** Cache helpers */
    _getCache() {
        try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; }
    },
    _setCache(entries) {
        try { localStorage.setItem(this.KEY, JSON.stringify(entries)); } catch {}
    },

    /** Hapus semua log — dari Appwrite & cache */
    async clear() {
        const confirmed = await showConfirm(
            'Hapus Riwayat Aktivitas',
            'Apakah Anda yakin ingin menghapus semua riwayat aktivitas? Tindakan ini tidak dapat dibatalkan.',
            { type: 'danger', confirmText: 'Ya, Hapus Semua', icon: 'fa-trash-can' }
        );
        if (!confirmed) return;

        // Hapus dari localStorage cache
        try { localStorage.removeItem(this.KEY); } catch {}
        this._updateBadge([]);
        // Hapus dari Appwrite di background
        const listEl = document.getElementById('activity-list');
        if (listEl) listEl.innerHTML = `<div class="activity-empty"><i class="fa-solid fa-spinner fa-spin"></i> Menghapus...</div>`;
        API.clearLogs().then(() => {
            this.render();
            if (typeof showToast === 'function') showToast('Riwayat aktivitas berhasil dihapus', 'success');
        }).catch(() => {
            if (listEl) listEl.innerHTML = `<div class="activity-empty"><i class="fa-solid fa-box-open"></i> Belum ada riwayat aktivitas</div>`;
        });
    },

    /** Set filter aktif */
    setFilter(filter) {
        this._filter = filter;
        document.querySelectorAll('.activity-pill').forEach(p =>
            p.classList.toggle('active', p.dataset.filter === filter)
        );
        this.render();
    },

    /** Format timestamp relatif */
    _relativeTime(ts) {
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 60) return 'Baru saja';
        if (diff < 3600) return `${Math.floor(diff/60)} menit lalu`;
        if (diff < 86400) return `${Math.floor(diff/3600)} jam lalu`;
        if (diff < 86400*7) return `${Math.floor(diff/86400)} hari lalu`;
        return new Date(ts).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
    },

    /** Inisial untuk avatar */
    _initials(name) {
        if (!name) return '?';
        return name.split(/[\s@]+/).slice(0,2).map(s => s[0]?.toUpperCase()).join('');
    },

    /** Warna avatar konsisten per user */
    _avatarColor(str) {
        const palette = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#f97316','#06b6d4'];
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
        return palette[Math.abs(hash) % palette.length];
    },

    /** Update badge di sidebar */
    _updateBadge(entries) {
        const badge = document.getElementById('activity-badge');
        if (!badge) return;
        const count = entries.length;
        if (count > 0) {
            badge.style.display = 'flex';
            badge.textContent = count > 99 ? '99+' : count;
        } else {
            badge.style.display = 'none';
        }
    },

    /** Render log ke panel — fetch dari Appwrite, update cache, tampilkan */
    render() {
        const listEl   = document.getElementById('activity-list');
        const footerEl = document.getElementById('activity-footer');
        if (!listEl) return;

        // Tampilkan cache lokal dulu agar tidak blank saat loading
        const cached = this._getCache();
        if (cached.length > 0) this._renderEntries(cached);
        else listEl.innerHTML = `<div class="activity-empty"><i class="fa-solid fa-spinner fa-spin"></i>Memuat riwayat...</div>`;

        // Fetch terbaru dari Appwrite
        API.getLogs(this.MAX).then(docs => {
            // Normalisasi field dari Appwrite doc
            const entries = docs.map(d => ({
                id:        d.$id,
                action:    d.action,
                label:     d.label,
                detail:    d.detail || '',
                user:      d.user   || 'Unknown',
                userEmail: d.userEmail || '',
                ts:        d.ts
            }));
            // Update cache lokal
            this._setCache(entries);
            this._updateBadge(entries);
            this._renderEntries(entries);
            if (footerEl) footerEl.textContent = `${entries.length} aktivitas tercatat`;
        }).catch(() => {
            // Fallback ke cache lokal jika Appwrite gagal
            this._renderEntries(cached);
        });
    },

    /** Render daftar entry ke DOM (dipakai oleh render() dan add()) */
    _renderEntries(allEntries) {
        const listEl   = document.getElementById('activity-list');
        const footerEl = document.getElementById('activity-footer');
        if (!listEl) return;

        // Apply filter
        let entries = allEntries;
        if (this._filter !== 'all') {
            entries = allEntries.filter(e =>
                (this._categories[e.action] || 'other') === this._filter
            );
        }

        if (footerEl) footerEl.textContent = `${allEntries.length} aktivitas tercatat`;

        if (entries.length === 0) {
            listEl.innerHTML = `<div class="activity-empty"><i class="fa-solid fa-box-open"></i>Belum ada riwayat aktivitas</div>`;
            return;
        }

        listEl.innerHTML = '';
        let lastDate = null;

        entries.forEach(entry => {
            const entryDate = new Date(entry.ts).toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
            if (entryDate !== lastDate) {
                const sep = document.createElement('div');
                sep.className = 'activity-date-sep';
                sep.textContent = entryDate;
                listEl.appendChild(sep);
                lastDate = entryDate;
            }

            const icon     = this._icons[entry.action] || { cls: 'edit', fa: 'fa-circle-info' };
            const userName = entry.user || 'Unknown';
            const initials = this._initials(userName);
            const avatarBg = this._avatarColor(userName);
            const timeStr  = new Date(entry.ts).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });

            const isInvoiceAction = ['delete_invoice', 'edit_invoice'].includes(entry.action);

            const item = document.createElement('div');
            item.className = 'activity-item';
            item.innerHTML = `
                <div class="activity-icon ${icon.cls}"><i class="fa-solid ${icon.fa}"></i></div>
                <div class="activity-body">
                    <div class="activity-label" title="${entry.label}">${entry.label}</div>
                    ${entry.detail ? `<div class="activity-detail" title="${entry.detail}">${entry.detail}</div>` : ''}
                    <div class="activity-meta">
                        <span class="activity-user-avatar" style="background:${avatarBg}" title="${entry.userEmail || userName}">${initials}</span>
                        <span class="activity-user-name">${userName}</span>
                        <span class="activity-dot">&middot;</span>
                        <span class="activity-time">${this._relativeTime(entry.ts)}</span>
                        <span class="activity-clock">${timeStr}</span>
                        ${isInvoiceAction
                            ? `<button class="activity-restore-btn" onclick="ActivityLog.restore(${JSON.stringify(entry).replace(/"/g,'&quot;')})" title="Pulihkan / kembalikan versi invoice ini"><i class="fa-solid fa-rotate-left"></i> Pulihkan</button>`
                            : ''}
                    </div>
                </div>
            `;
            listEl.appendChild(item);
        });
    }
};

/** Toggle activity log panel */
window.toggleActivityPanel = function(forceState) {
    const panel   = document.getElementById('activity-panel');
    const overlay = document.getElementById('activity-overlay');
    if (!panel) return;
    const isOpen    = panel.classList.contains('open');
    const shouldOpen = forceState !== undefined ? forceState : !isOpen;
    panel.classList.toggle('open', shouldOpen);
    if (overlay) overlay.classList.toggle('open', shouldOpen);
    if (shouldOpen) ActivityLog.render();
};


// Analytics Chart Instances & State
let revenueChart = null;
let typeChart = null;
let paymentChart = null;
let analyticsRangeMonths = 6;

function getViews() {
    return {
        dashboard: document.getElementById('view-dashboard'),
        analytics: document.getElementById('view-analytics'),
        create: document.getElementById('view-create'),
        bapb: document.getElementById('view-bapb')
    };
}
function getNavs() {
    return {
        dashboard: document.getElementById('nav-dashboard'),
        analytics: document.getElementById('nav-analytics'),
        create: document.getElementById('nav-create'),
        bapb: document.getElementById('nav-bapb')
    };
}

function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

function switchView(viewName) {
    const views = getViews();
    const navs = getNavs();
    Object.values(views).forEach(v => { if (v) v.style.display = 'none'; });
    Object.values(navs).forEach(n => { if (n) n.classList.remove('active'); });
    if (views[viewName]) views[viewName].style.display = 'block';
    if (navs[viewName]) navs[viewName].classList.add('active');
    closeMobileSidebar();

    // Toggle Mobile FAB (only visible on dashboard view)
    const fab = document.getElementById('mobile-fab-create');
    if (fab) fab.style.display = viewName === 'dashboard' ? '' : 'none';
}

document.getElementById('nav-dashboard')?.addEventListener('click', (e) => { e.preventDefault(); switchView('dashboard'); loadInvoices(1); });
document.getElementById('nav-analytics')?.addEventListener('click', (e) => { e.preventDefault(); switchView('analytics'); renderAnalyticsDashboard(); });
document.getElementById('nav-create')?.addEventListener('click', (e) => { e.preventDefault(); showCreate('normal'); });
document.getElementById('nav-create-rental')?.addEventListener('click', (e) => { e.preventDefault(); showCreate('rental'); });
document.getElementById('nav-bapb')?.addEventListener('click', (e) => { e.preventDefault(); showBapbView(); });


function showDashboard() { switchView('dashboard'); loadInvoices(1); }

function showCreate(type = 'normal') { 
    editingId = null;
    switchView('create'); 
    resetForm(); 
    closeMobileSidebar();
    window.setFormType(type);
    document.getElementById('submit-btn').innerHTML = '<i class="fa-solid fa-save"></i> Simpan ke Appwrite';

    // Update form status badge
    const badge = document.getElementById('form-status-badge');
    if (badge) {
        badge.className = 'form-status-badge badge-create';
        badge.innerHTML = '<i class="fa-solid fa-plus-circle"></i> Buat Baru';
    }
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
    const navs = typeof getNavs === 'function' ? getNavs() : {};
    if (navs && navs.create) navs.create.classList.toggle('active', !isRental);
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
    document.getElementById('grand-total').textContent = isPrivacyMode ? '***.***.***' : total.toLocaleString('id-ID');
    return Number(total.toFixed(0)); // Ensure it's a clean integer for Appwrite if needed
}

window.roundTotal = function() {
    const rows = document.querySelectorAll('.item-row');
    if (rows.length === 0) {
        notify('Tidak ada item untuk dibulatkan.', 'warning');
        return;
    }

    let total = 0;
    rows.forEach(row => {
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        const price = parseFloat(row.querySelector('.item-price').value) || 0;
        total += (qty * price);
    });

    const rounded = Math.round(total / 1000) * 1000;
    const diff = rounded - total;

    if (diff === 0) {
        notify('Total sudah bulat (kelipatan Rp 1.000).', 'info');
        return;
    }

    // Adjust the last item's price to make the total round
    const lastRow = rows[rows.length - 1];
    const lastQty = parseFloat(lastRow.querySelector('.item-qty').value) || 1;
    const lastPrice = parseFloat(lastRow.querySelector('.item-price').value) || 0;
    const adjustment = diff / lastQty;
    lastRow.querySelector('.item-price').value = Math.round(lastPrice + adjustment);

    calculateTotal();
    notify(`Total dibulatkan ke ${formatRupiah(rounded)} (selisih ${formatRupiah(Math.abs(diff))})`, 'success');
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
function _showToast(message, type = 'info', duration) {
    // Internal toast implementation
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
    toast.querySelector('.toast-close-btn').onclick = () => dismissToast(toast);
    container.appendChild(toast);
    const timer = setTimeout(() => dismissToast(toast), ms);
    toast._timer = timer;
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
    const all = container.querySelectorAll('.toast-item:not(.toast-exit)');
    if (all.length > 5) dismissToast(all[0]);
    return toast;
}

function notify(message, type = 'info', duration) {
    // Public wrapper for toast notifications; can be extended later.
    return _showToast(message, type, duration);
}

function showToast(message, type = 'info', duration) {
    return _showToast(message, type, duration);
}
window.showToast = showToast;

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
                createdTs: new Date(inv.date || inv.$createdAt || Date.now()).getTime(),
                dismissed: notifDismissed.includes(key)
            });
        } catch(e) {}
    });

    // Urutkan: sewa terbaru (paling baru dibuat/diisikan) berada di paling atas
    newNotifs.sort((a, b) => b.createdTs - a.createdTs);
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
            openRentalForm(n);
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

// Open the rental invoice creation form pre‑filled based on a notification
function openRentalForm(notif) {
    // Cari invoice asli dari cache statsData atau currentInvoices
    const invoice = (statsData.length > 0 ? statsData : currentInvoices).find(v => v.$id === notif.invoiceId);

    if (invoice) {
        // Gunakan createRentalForThisMonth yang sudah lengkap pre-fill semua field
        // tapi karena fungsi itu cari dari currentInvoices, kita lakukan inline di sini
        // agar bisa cari dari statsData juga

        let savedNotes = '';
        let itemsArray = [];
        let descArr    = [];
        let flags      = { showInv: true, showPo: true, showSite: true, showDate: true };

        try {
            const itemObj = typeof invoice.items === 'string' ? JSON.parse(invoice.items) : invoice.items;
            const noteObj = invoice.note ? (typeof invoice.note === 'string' ? JSON.parse(invoice.note) : invoice.note) : null;

            if (noteObj) {
                savedNotes = noteObj.notes || '';
                descArr    = noteObj.desc  || [];
                flags      = noteObj.flags || flags;
                itemsArray = Array.isArray(itemObj) ? itemObj : [];
            } else {
                savedNotes = itemObj?.notes || '';
                flags      = itemObj?.flags || flags;
                itemsArray = itemObj?.itemList || (Array.isArray(itemObj) ? itemObj : []);
            }
        } catch(e) {}

        // Buka form sewa (mode buat baru, bukan edit)
        showCreate('rental');
        document.getElementById('form-title').textContent = 'Buat Invoice Sewa (Bulan Ini)';

        // Log aktivitas
        const clientNameLog = (Array.isArray(invoice.clientName) ? invoice.clientName[0] : invoice.clientName) || notif.clientName || '-';
        ActivityLog.add('notif_open_form', `Form sewa dibuka dari notifikasi`, `Klien: ${clientNameLog}`);

        // Isi data klien & catatan dari invoice asli
        document.getElementById('inv-client').value = (Array.isArray(invoice.clientName) ? invoice.clientName[0] : invoice.clientName) || '';
        document.getElementById('inv-wa').value     = invoice.clientAddress || '';
        document.getElementById('inv-po').value     = invoice.noPo  || '';
        document.getElementById('inv-site').value   = invoice.site  || '';
        document.getElementById('inv-notes').value  = savedNotes;

        // Terapkan flags tampilan
        if (document.getElementById('chk-show-inv'))  document.getElementById('chk-show-inv').checked  = (flags.showInv  !== false);
        if (document.getElementById('chk-show-po'))   document.getElementById('chk-show-po').checked   = (flags.showPo   !== false);
        if (document.getElementById('chk-show-site')) document.getElementById('chk-show-site').checked = (flags.showSite !== false);
        if (document.getElementById('chk-show-date')) document.getElementById('chk-show-date').checked = (flags.showDate !== false);
        if (document.getElementById('chk-show-tbbg')) document.getElementById('chk-show-tbbg').checked = (flags.showTbBg !== false);

        // Hitung tanggal bulan ini (gunakan hari awal dari invoice asli)
        const now      = new Date();
        const curYear  = now.getFullYear();
        const curMonth = now.getMonth();

        let originalDay = 1;
        try {
            const noteObj = invoice.note ? (typeof invoice.note === 'string' ? JSON.parse(invoice.note) : invoice.note) : null;
            if (noteObj?.rental?.awal) {
                const origDate = new Date(noteObj.rental.awal);
                if (!isNaN(origDate.getTime())) originalDay = origDate.getDate();
            }
        } catch(e) {}

        const maxDays   = new Date(curYear, curMonth + 1, 0).getDate();
        const startDay  = Math.min(originalDay, maxDays);
        const startDate = new Date(curYear, curMonth, startDay);
        const endDate   = new Date(curYear, curMonth + 1, startDay);

        const formatISO = d => {
            const y   = d.getFullYear();
            const m   = (d.getMonth() + 1).toString().padStart(2, '0');
            const day = d.getDate().toString().padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        // Tanggal invoice = hari ini; tanggal sewa = bulan ini
        document.getElementById('inv-date').value   = formatISO(now);
        document.getElementById('sewa-awal').value  = formatISO(startDate);
        document.getElementById('sewa-akhir').value = formatISO(endDate);

        // Isi item dari invoice asli
        document.getElementById('items-container').innerHTML = '';
        itemCount = 0;

        if (itemsArray.length > 0) {
            itemsArray.forEach((item, idx) => {
                itemCount++;
                const row = createItemRow(itemCount);
                row.querySelector('.item-name').value  = item.name  || '';
                row.querySelector('.item-qty').value   = item.qty   || 1;
                row.querySelector('.item-price').value = item.price || 0;
                const descVal = descArr[idx] !== undefined ? descArr[idx] : (item.desc || '');
                if (row.querySelector('.item-desc')) row.querySelector('.item-desc').value = descVal;
                document.getElementById('items-container').appendChild(row);
            });
        } else {
            addItemRow();
        }

        calculateTotal();

    } else {
        // Fallback jika invoice tidak ditemukan di cache: buka form kosong dengan nama klien
        showCreate('rental');
        document.getElementById('inv-client').value = notif.clientName || '';
        const now = new Date();
        const monthYear = now.toLocaleString('id-ID', { month: 'long', year: 'numeric' });
        document.getElementById('inv-notes').value = `Perpanjangan sewa untuk ${monthYear}`;
    }
}


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
    const typeFilter = currentTypeFilter;
    
    try {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center loading-text"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data tagihan...</td></tr>';
        
        const result = await API.getInvoices(itemsPerPage, offset, searchQuery, typeFilter, currentSortBy, currentSortDir);
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
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation"></i> Error Koneksi: ${e.message}</td></tr>`;
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

        // Setelah background load selesai, tidak perlu lagi filter manual 
        // karena search sekarang murni di-handle oleh server.
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

// Navigasi halaman
function navigateToPage(page) {
    loadInvoices(page);
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

window.setFilterType = function(type) {
    currentTypeFilter = type;
    document.querySelectorAll('.filter-pill').forEach(el => el.classList.remove('active'));
    document.querySelector(`.filter-pill[data-type="${type}"]`).classList.add('active');
    filterInvoices();
}

window.handleSortSelect = function(value) {
    if (!value) return;
    const parts = value.split('_');
    currentSortBy = parts[0];
    currentSortDir = parts[1] || 'desc';
    
    // Update table header icons
    document.querySelectorAll('th.sortable').forEach(th => {
        th.classList.remove('active-sort');
        const icon = th.querySelector('.sort-icon');
        if (icon) icon.className = 'fa-solid fa-sort sort-icon';
    });
    
    const activeTh = document.querySelector(`th[onclick="handleSort('${currentSortBy}')"]`);
    if (activeTh) {
        activeTh.classList.add('active-sort');
        const activeIcon = activeTh.querySelector('.sort-icon');
        if (activeIcon) {
            activeIcon.className = `fa-solid fa-sort-${currentSortDir === 'desc' ? 'down' : 'up'} sort-icon`;
        }
    }

    loadInvoices(1);
};

window.handleSort = function(column) {
    if (currentSortBy === column) {
        currentSortDir = currentSortDir === 'desc' ? 'asc' : 'desc';
    } else {
        currentSortBy = column;
        currentSortDir = 'desc'; // default when changing column
    }
    
    // Sync select dropdown if matching option exists
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        const targetVal = `${currentSortBy}_${currentSortDir}`;
        const matchOpt = Array.from(sortSelect.options).find(opt => opt.value === targetVal);
        if (matchOpt) sortSelect.value = targetVal;
    }

    // Update UI icons
    document.querySelectorAll('th.sortable').forEach(th => {
        th.classList.remove('active-sort');
        const icon = th.querySelector('.sort-icon');
        if (icon) icon.className = 'fa-solid fa-sort sort-icon';
    });
    
    const activeTh = document.querySelector(`th[onclick="handleSort('${column}')"]`);
    if (activeTh) {
        activeTh.classList.add('active-sort');
        const activeIcon = activeTh.querySelector('.sort-icon');
        if (activeIcon) {
            activeIcon.className = `fa-solid fa-sort-${currentSortDir === 'desc' ? 'down' : 'up'} sort-icon`;
        }
    }
    
    loadInvoices(1);
};

window.filterInvoices = function() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.style.display = searchInput?.value ? 'flex' : 'none';

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        loadInvoices(1);
    }, 300);
}

window.clearSearch = function() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.style.display = 'none';
    loadInvoices(1);
}

function renderInvoiceTable(docs) {
    if (!docs) docs = currentInvoices;
    if (!docs || !Array.isArray(docs)) return;
    const tbody = document.getElementById('invoice-list');
    
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

    // Catatan: filter tipe (Reguler/Sewa) dan pengurutan kini dilakukan server-side di loadInvoices/API
    // sehingga totalItems sudah akurat untuk pagination dan semua halaman tersortir secara konsisten.

    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color:var(--text-muted)">Data tidak ditemukan.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    items.forEach(({ invoice, isRental, itemKeterangan }) => {
        const createdDateStr = invoice.$createdAt ? new Date(invoice.$createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong>${invoice.NoInvoice}</strong>
                <br><span class="badge ${isRental ? 'badge-sewa' : 'badge-reguler'}">${isRental ? 'Sewa' : 'Reguler'}</span>
            </td>
            <td>${Array.isArray(invoice.clientName) ? invoice.clientName[0] : invoice.clientName}</td>
            <td style="font-size:0.85em;">${itemKeterangan}</td>
            <td>${new Date(invoice.date).toLocaleDateString('id-ID')}</td>
            <td style="font-size:0.85em; color:var(--text-muted);">${createdDateStr}</td>
            <td style="font-weight:600; color:var(--text-main)">${formatRupiah(invoice.totalAmount)}</td>
            <td>
                <select class="status-select status-${invoice.paymentStatus || 'pending'}" onchange="updatePaymentStatus('${invoice.$id}', this.value); this.className='status-select status-'+this.value;">
                    <option value="pending" ${invoice.paymentStatus === 'pending' ? 'selected' : ''}>Belum Lunas</option>
                    <option value="paid" ${invoice.paymentStatus === 'paid' ? 'selected' : ''}>Lunas</option>
                    <option value="overdue" ${invoice.paymentStatus === 'overdue' ? 'selected' : ''}>Jatuh Tempo</option>
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
    if (!docs) docs = statsData;
    if (!docs || !Array.isArray(docs)) return;
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    
    let totalAll = 0;
    let countAll = docs.length;
    let totalMonth = 0;
    let countMonth = 0;
    let totalPaid = 0;
    let countPaid = 0;
    let totalPending = 0;
    let countPending = 0;
    
    docs.forEach(inv => {
        const amount = Number(inv.totalAmount) || 0;
        const status = String(inv.paymentStatus || 'pending').toLowerCase();
        totalAll += amount;
        
        const invDate = new Date(inv.date || inv.$createdAt);
        if (invDate.getMonth() === thisMonth && invDate.getFullYear() === thisYear) {
            totalMonth += amount;
            countMonth++;
        }

        if (status === 'paid') {
            totalPaid += amount;
            countPaid++;
        } else {
            totalPending += amount;
            countPending++;
        }
    });
    
    const mTotalEl = document.getElementById('stat-month-total');
    if (mTotalEl) mTotalEl.textContent = formatRupiah(totalMonth);
    
    const mCountEl = document.getElementById('stat-month-count');
    if (mCountEl) mCountEl.textContent = countMonth + ' Invoice';
    
    const aTotalEl = document.getElementById('stat-all-total');
    if (aTotalEl) aTotalEl.textContent = formatRupiah(totalAll);
    
    const aCountEl = document.getElementById('stat-all-count');
    if (aCountEl) aCountEl.textContent = countAll + ' Invoice';

    const pTotalEl = document.getElementById('stat-paid-total');
    if (pTotalEl) pTotalEl.textContent = formatRupiah(totalPaid);

    const pCountEl = document.getElementById('stat-paid-count');
    if (pCountEl) pCountEl.textContent = countPaid + ' Invoice';

    const pendTotalEl = document.getElementById('stat-pending-total');
    if (pendTotalEl) pendTotalEl.textContent = formatRupiah(totalPending);

    const pendCountEl = document.getElementById('stat-pending-count');
    if (pendCountEl) pendCountEl.textContent = countPending + ' Invoice';
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
                showInv:   document.getElementById('chk-show-inv').checked,
                showPo:    document.getElementById('chk-show-po').checked,
                showSite:  document.getElementById('chk-show-site').checked,
                showDate:  document.getElementById('chk-show-date').checked,
                showTbBg:  document.getElementById('chk-show-tbbg').checked
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

        // Ambil snapshot data lama sebelum update (untuk restore)
        let prevSnapshot = '';
        if (editingId) {
            const prev = currentInvoices.find(v => v.$id === editingId) || statsData.find(v => v.$id === editingId);
            if (prev) prevSnapshot = ActivityLog.makeSnapshot(prev);
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

        notify(editingId ? 'Invoice berhasil diperbarui!' : 'Invoice berhasil direkam!', 'success');

        // Log aktivitas
        const savedType   = editingId ? 'edit_invoice' : 'create_invoice';
        const savedLabel  = editingId
            ? `Invoice ${invoiceData.NoInvoice} diperbarui`
            : `Invoice ${invoiceData.NoInvoice} dibuat`;
        const savedClient = Array.isArray(invoiceData.clientName) ? invoiceData.clientName[0] : invoiceData.clientName;
        ActivityLog.add(savedType, savedLabel,
            `Klien: ${savedClient || '-'} | Total: ${formatRupiah(invoiceData.totalAmount||0)}`,
            { invoiceId: editingId || '', snapshot: prevSnapshot || ActivityLog.makeSnapshot(invoiceData) }
        );

        editingId = null;
        statsData = []; // Reset stats cache to force reload
        showDashboard();
    } catch (e) {
        notify('Gagal menyimpan ke Appwrite: ' + e.message, 'error');
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

    // Update form status badge to edit mode
    const badge = document.getElementById('form-status-badge');
    if (badge) {
        badge.className = 'form-status-badge badge-edit';
        badge.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Edit Invoice';
    }

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
    document.getElementById('chk-show-date').checked = (flags.showDate !== false);
    document.getElementById('chk-show-tbbg').checked = (flags.showTbBg !== false);

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
    const invoice = currentInvoices.find(v => v.$id === id) || statsData.find(v => v.$id === id);
    const confirmed = await showConfirm('Hapus Invoice', 'Data invoice ini akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan.', { type: 'danger', confirmText: 'Ya, Hapus', icon: 'fa-trash-can' });
    if (confirmed) {
        try {
            // Ambil snapshot sebelum dihapus
            const snapshot = invoice ? ActivityLog.makeSnapshot(invoice) : '';
            const invNo    = invoice ? (invoice.NoInvoice || id) : id;
            const client   = invoice ? (Array.isArray(invoice.clientName) ? invoice.clientName[0] : invoice.clientName) : '-';

            await API.deleteInvoice(id);
            notify('Invoice berhasil dihapus', 'success');
            ActivityLog.add(
                'delete_invoice',
                `Invoice ${invNo} dihapus`,
                `Klien: ${client} | Total: ${formatRupiah(invoice?.totalAmount||0)}`,
                { invoiceId: id, snapshot }
            );
            statsData = [];
            loadInvoices(currentPage);
        } catch(e) {
            notify('Gagal menghapus: ' + e.message, 'error');
        }
    }
}

window.updatePaymentStatus = async function(id, newStatus) {
    try {
        await API.updateInvoiceStatus(id, newStatus);
        notify('Status pembayaran diperbarui', 'success');
        ActivityLog.add('update_status', `Status invoice diubah ke: ${newStatus}`, `ID: ${id}`);
    } catch (e) {
        notify('Gagal mengupdate status: ' + e.message, 'error');
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
            ActivityLog.add('download_pdf', `PDF diunduh: ${invoice.NoInvoice}`, `Klien: ${Array.isArray(invoice.clientName) ? invoice.clientName[0] : invoice.clientName}`);
            if (invoice.paymentStatus === 'pending') {
                updatePaymentStatus(id, 'paid');
            }
        } catch (e) {
            console.error("Download PDF Error:", e);
            notify('Gagal mengunduh PDF: ' + e.message, 'error');
        }
    } else {
        notify('Data invoice tidak ditemukan.', 'warning');
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
            ActivityLog.add('share_pdf', `PDF dibagikan: ${invoice.NoInvoice}`, `Klien: ${Array.isArray(invoice.clientName) ? invoice.clientName[0] : invoice.clientName}`);
        } else {
            notify('Browser/Ponsel Anda tidak mendukung share file PDF. Mengunduh file...', 'warning');
            await window.generatePDF(invoice, 'download');
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            notify('Gagal membagikan dokumen: ' + e.message, 'error');
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
        notify('Gagal membuat pratinjau: ' + e.message, 'error');
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
        // Simpan info user ke ActivityLog
        ActivityLog.setUser(email, email.split('@')[0]);
        ActivityLog.add('login', `Login berhasil`, `Email: ${email}`);
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
            const logoutUser = ActivityLog.getUser();
            ActivityLog.add('logout', `${logoutUser.name || logoutUser.email} logout`, '');
            ActivityLog.clearUser();
            await API.logout();
            window.location.reload();
        } catch (e) {
            notify('Gagal logout: ' + e.message, 'error');
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
    updatePrivacyUI();
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
            // Already logged in — load user info ke ActivityLog
            const userName = session.name || (session.email ? session.email.split('@')[0] : 'Admin');
            ActivityLog.setUser(session.email || '', userName);
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

// ── Gemini API config (client-side, Gemini 3.5 Flash Lite) ────────────────
const GEMINI_API_KEY = 'AIzaSyDIwa7qO-bASLVwOYoub-XJXQEm4AeCPgE';
const GEMINI_MODEL   = 'gemini-3.5-flash-lite';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Pure JS instant text extraction from PDF stream (0.1ms, zero worker overhead)
function extractPdfTextPureJs(arrayBuffer) {
    try {
        const bytes = new Uint8Array(arrayBuffer);
        let str = '';
        const len = bytes.length;
        // Limit string scanning to first 500KB for speed
        const scanLen = Math.min(len, 500000);
        for (let i = 0; i < scanLen; i++) {
            str += String.fromCharCode(bytes[i]);
        }
        const textMatches = [];
        const tjRegex = /\(([^)]+)\)\s*Tj/g;
        let match;
        while ((match = tjRegex.exec(str)) !== null) {
            if (match[1] && match[1].trim().length > 0) {
                textMatches.push(match[1]);
            }
        }
        const arrayTjRegex = /\[\s*((?:\((?:[^)]+)\)\s*)*)\]\s*TJ/g;
        while ((match = arrayTjRegex.exec(str)) !== null) {
            const inner = match[1];
            const innerRegex = /\(([^)]+)\)/g;
            let innerMatch;
            let combined = '';
            while ((innerMatch = innerRegex.exec(inner)) !== null) {
                combined += innerMatch[1];
            }
            if (combined.trim().length > 0) {
                textMatches.push(combined);
            }
        }
        return textMatches.join(' ').replace(/\s+/g, ' ').trim();
    } catch (e) {
        console.warn('Pure JS PDF text extraction failed:', e);
        return '';
    }
}

// Ultra-fast Gemini AI call using extracted text (1-2s total response time)
async function callGeminiText(pdfText) {
    const prompt = `You are an expert invoice data extractor. Read the invoice text below and return ONLY a valid JSON object — no markdown formatting, no explanation.

Rules:
- clientName: the client/buyer company name. NEVER use "PUTRA BANUA MANDIRI" (that is the vendor/seller).
- clientAddress: use address labelled "ALAMAT PENGIRIMAN BARANG" or buyer address if present.
- price: integer (strip Rp and dots/commas, e.g. 5000000).
- tb: Tugboat name (e.g. TB KSA-01). bg: Barge name (e.g. BG 3001). desc: extra description.
- type: "rental" if sewa/rental is mentioned in invoice title or items, else "normal".
- items: array of objects, one per line item — do NOT merge multiple items into one.

JSON schema:
{"clientName":"","clientAddress":"","noPo":"","site":"","date":"YYYY-MM-DD","type":"normal","items":[{"name":"","qty":1,"price":0,"tb":"","bg":"","desc":""}]}

INVOICE TEXT:
${pdfText.slice(0, 4000)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25-second timeout for text

    try {
        const res = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0,
                    maxOutputTokens: 1024
                }
            })
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const msg = errBody?.error?.message || res.statusText;
            if (res.status === 429) throw new Error('Rate limit Gemini AI. Tunggu beberapa detik lalu coba lagi.');
            throw new Error(`Gemini AI error (${res.status}): ${msg}`);
        }

        const json = await res.json();
        let text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('Respon Gemini AI terlalu lama (timeout 25 detik). Coba upload lagi.');
        }
        throw err;
    }
}

// Fallback: Gemini Multimodal PDF Base64 call (for image/scanned PDFs)
async function callGeminiPdfBase64(base64Data) {
    const prompt = `You are an expert invoice data extractor. Read the attached PDF invoice document (both text and visual layout) and extract the invoice fields into ONLY a valid JSON object — no markdown formatting, no explanation.

Rules:
- clientName: the client/buyer company name. NEVER use "PUTRA BANUA MANDIRI" (that is the vendor/seller).
- clientAddress: use address labelled "ALAMAT PENGIRIMAN BARANG" or buyer address if present.
- price: integer (strip Rp and dots/commas, e.g. 5000000).
- tb: Tugboat name (e.g. TB KSA-01). bg: Barge name (e.g. BG 3001). desc: extra description.
- type: "rental" if sewa/rental is mentioned in invoice title or items, else "normal".
- items: array of objects, one per line item — do NOT merge multiple items into one.

JSON schema:
{"clientName":"","clientAddress":"","noPo":"","site":"","date":"YYYY-MM-DD","type":"normal","items":[{"name":"","qty":1,"price":0,"tb":"","bg":"","desc":""}]}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45-second timeout for base64 OCR

    try {
        const res = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {
                            inlineData: {
                                mimeType: "application/pdf",
                                data: base64Data
                            }
                        },
                        { text: prompt }
                    ]
                }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0,
                    maxOutputTokens: 1024
                }
            })
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const msg = errBody?.error?.message || res.statusText;
            if (res.status === 429) throw new Error('Rate limit Gemini AI. Tunggu beberapa detik lalu coba lagi.');
            throw new Error(`Gemini AI error (${res.status}): ${msg}`);
        }

        const json = await res.json();
        let text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('Respon Gemini AI terlalu lama (timeout 45 detik). Coba upload lagi.');
        }
        throw err;
    }
}

window.handlePdfScan = async function(input) {
    const file = input.files[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        notify('Mohon pilih file berformat PDF.', 'error');
        input.value = '';
        return;
    }

    if (file.size > 15 * 1024 * 1024) {
        notify('Ukuran file PDF terlalu besar (maksimal 15MB).', 'error');
        input.value = '';
        return;
    }

    const overlay  = document.getElementById('scanning-overlay');
    const mainText = document.getElementById('scan-main-text');
    const subText  = document.getElementById('scan-sub-text');

    if (overlay) overlay.style.display = 'flex';
    if (mainText) mainText.textContent = 'Membaca File PDF...';
    if (subText)  subText.textContent  = 'Mengekstrak data dari dokumen';

    const t1 = setTimeout(() => {
        if (overlay && overlay.style.display !== 'none') {
            if (mainText) mainText.textContent = 'Menghubungkan ke Gemini AI...';
            if (subText)  subText.textContent  = 'Mengirim dokumen ke Google Gemini 3.5 Flash Lite';
        }
    }, 1200);
    const t2 = setTimeout(() => {
        if (overlay && overlay.style.display !== 'none') {
            if (mainText) mainText.textContent = 'Gemini AI sedang menganalisis...';
            if (subText)  subText.textContent  = 'Mengekstrak nama klien, alamat, dan rincian item';
        }
    }, 3000);

    try {
        const arrayBuffer = await file.arrayBuffer();
        const extractedText = extractPdfTextPureJs(arrayBuffer);
        let data;

        if (extractedText && extractedText.length > 25) {
            console.log(`[Scan PDF] Fast Text Extraction success (${extractedText.length} chars). Sending text to Gemini AI...`);
            if (subText) subText.textContent = 'Menghubungkan ke Gemini AI (Mode Teks Cepat)...';
            data = await callGeminiText(extractedText);
        } else {
            console.log('[Scan PDF] Scanned/Image PDF detected or text empty. Falling back to Gemini Multimodal OCR...');
            if (subText) subText.textContent = 'Menganalisis dokumen PDF dengan Gemini AI OCR...';
            
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const res = reader.result;
                    const base64 = typeof res === 'string' && res.includes(',') ? res.split(',')[1] : res;
                    resolve(base64);
                };
                reader.onerror = () => reject(new Error('Gagal membaca file PDF lokal.'));
                reader.readAsDataURL(file);
            });

            data = await callGeminiPdfBase64(base64Data);
        }

        // Populate form fields with safe null checks
        if (data.type) { showCreate(data.type); highlightField('form-title'); }

        const elClient = document.getElementById('inv-client');
        const elWa     = document.getElementById('inv-wa');
        const elPo     = document.getElementById('inv-po');
        const elSite   = document.getElementById('inv-site');
        const elDate   = document.getElementById('inv-date');

        if (data.clientName && elClient)    { elClient.value = data.clientName;    highlightField('inv-client'); }
        if (data.clientAddress && elWa)     { elWa.value     = data.clientAddress; highlightField('inv-wa'); }
        if (data.noPo && elPo)              { elPo.value     = data.noPo;          highlightField('inv-po'); }
        if (data.site && elSite)            { elSite.value   = data.site;          highlightField('inv-site'); }
        if (data.date && elDate)            { elDate.value   = data.date.split('T')[0]; highlightField('inv-date'); }

        const itemsContainer = document.getElementById('items-container');
        if (data.items && Array.isArray(data.items) && data.items.length > 0 && itemsContainer) {
            itemsContainer.innerHTML = '';
            itemCount = 0;
            data.items.forEach(item => {
                itemCount++;
                const row = createItemRow(itemCount);
                if (row.querySelector('.item-name'))  row.querySelector('.item-name').value  = item.name  || '';
                if (row.querySelector('.item-qty'))   row.querySelector('.item-qty').value   = item.qty   || 1;
                if (row.querySelector('.item-price')) row.querySelector('.item-price').value = item.price || 0;
                if (item.tb && row.querySelector('.item-tb'))   row.querySelector('.item-tb').value   = item.tb;
                if (item.bg && row.querySelector('.item-bg'))   row.querySelector('.item-bg').value   = item.bg;
                if (item.desc && row.querySelector('.item-desc')) row.querySelector('.item-desc').value = item.desc;
                itemsContainer.appendChild(row);
                row.classList.add('scan-highlight');
            });
            if (typeof calculateTotal === 'function') calculateTotal();
        }

        notify('Gemini AI berhasil mengekstrak data PDF! Silakan tinjau kembali sebelum menyimpan.', 'success');

    } catch (error) {
        console.error('Scan Error:', error);
        let msg = error.message;
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
            msg = 'Tidak dapat terhubung ke Gemini AI. Periksa koneksi internet.';
        }
        notify(msg, 'error', 8000);
    } finally {
        clearTimeout(t1);
        clearTimeout(t2);
        if (overlay) overlay.style.display = 'none';
        if (input) input.value = '';
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
        const text = btn.textContent.trim();
        if (months === 0 && text === 'Semua') {
            btn.classList.add('active');
        } else if (months > 0 && text.includes(months + ' Bulan')) {
            btn.classList.add('active');
        }
    });

    renderAnalyticsDashboard();
};

function renderAnalyticsDashboard(docsTarget, skipAnimation = false) {
    const docs = docsTarget || (statsData.length > 0 ? statsData : currentInvoices);
    if (!docs || docs.length === 0) return;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Filter documents by analyticsRangeMonths if > 0
    let filteredDocs = docs;
    if (analyticsRangeMonths > 0) {
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - analyticsRangeMonths);
        filteredDocs = docs.filter(inv => {
            const d = new Date(inv.date || inv.$createdAt);
            return d >= cutoffDate;
        });
    }

    // 1. Calculate KPI Metrics
    let totalOmset = 0;
    let totalThisMonth = 0;
    let totalLastMonth = 0;
    let totalPaid = 0;
    let totalPending = 0;
    let totalOverdue = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;
    
    const clientFirstDates = {}; // clientName -> earliest Date
    const clientTotals = {};     // clientName -> { total: number, count: number }
    const typeCounts = { rental: 0, normal: 0 };
    const paymentCounts = { paid: 0, pending: 0, overdue: 0 };
    const monthlySummary = {};   // "YYYY-MM" -> { label, total, normal, rental, paid, pending, count }

    filteredDocs.forEach(inv => {
        const invDate = new Date(inv.date || inv.$createdAt);
        const amount = Number(inv.totalAmount) || 0;
        const cName = Array.isArray(inv.clientName) ? inv.clientName[0] : (inv.clientName || 'Tidak Diketahui');
        
        totalOmset += amount;

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
            totalPaid += amount;
        } else if (status === 'overdue') {
            paymentCounts.overdue++;
            overdueCount++;
            totalPending += amount;
            totalOverdue += amount;
        } else {
            paymentCounts.pending++;
            pendingCount++;
            totalPending += amount;
        }

        // Monthly breakdown
        if (invDate.getFullYear() === currentYear && invDate.getMonth() === currentMonth) {
            totalThisMonth += amount;
        }
        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        if (invDate.getFullYear() === lastMonthDate.getFullYear() && invDate.getMonth() === lastMonthDate.getMonth()) {
            totalLastMonth += amount;
        }

        // Monthly summary map
        const monthKey = `${invDate.getFullYear()}-${String(invDate.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlySummary[monthKey]) {
            const monthLabel = invDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
            monthlySummary[monthKey] = { label: monthLabel, total: 0, normal: 0, rental: 0, paid: 0, pending: 0, count: 0 };
        }
        monthlySummary[monthKey].total += amount;
        monthlySummary[monthKey].count += 1;
        if (isRental) monthlySummary[monthKey].rental += amount;
        else monthlySummary[monthKey].normal += amount;
        if (status === 'paid') monthlySummary[monthKey].paid += amount;
        else monthlySummary[monthKey].pending += amount;

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
    if (ytdEl) ytdEl.textContent = formatRupiah(totalOmset);

    const monthEl = document.getElementById('analytics-kpi-month');
    if (monthEl) monthEl.textContent = formatRupiah(totalThisMonth);

    const paidEl = document.getElementById('analytics-kpi-total-paid');
    if (paidEl) paidEl.textContent = formatRupiah(totalPaid);

    const pendingEl = document.getElementById('analytics-kpi-total-pending');
    if (pendingEl) pendingEl.textContent = formatRupiah(totalPending);

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

    // Collection Rate
    const totalDocs = filteredDocs.length;
    const paidRatePct = totalDocs > 0 ? Math.round((paidCount / totalDocs) * 100) : 0;
    const paidRateEl = document.getElementById('analytics-kpi-paid-rate');
    if (paidRateEl) paidRateEl.textContent = paidRatePct + '%';
    
    const paidCountEl = document.getElementById('analytics-kpi-paid-count');
    if (paidCountEl) paidCountEl.textContent = `${paidCount} invoice lunas`;

    const pendingCountEl = document.getElementById('analytics-kpi-pending-count');
    if (pendingCountEl) pendingCountEl.textContent = `${pendingCount + overdueCount} invoice belum terbayar`;

    const overdueCountEl = document.getElementById('analytics-kpi-overdue-count');
    if (overdueCountEl) overdueCountEl.textContent = `${overdueCount} invoice jatuh tempo`;

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

    // 3. Render Charts (fast update if skipAnimation=true)
    renderRevenueTrendChart(filteredDocs, analyticsRangeMonths || 6, skipAnimation);
    renderTypeDonutChart(typeCounts, skipAnimation);
    renderPaymentDonutChart(paymentCounts, skipAnimation);

    // 4. Render Lists & Monthly Breakdown Table
    renderTopClientsList(clientTotals);
    renderNewClientsList(newClients);
    renderMonthlyBreakdownTable(monthlySummary);
}

// Chart 1: Revenue Trend Bar Chart
function renderRevenueTrendChart(docs, monthsToShow = 6, skipAnimation = false) {
    const canvas = document.getElementById('chart-revenue-trend');
    if (!canvas || typeof Chart === 'undefined') return;

    const now = new Date();
    const monthLabels = [];
    const monthlyPaid = Array(monthsToShow).fill(0);
    const monthlyPending = Array(monthsToShow).fill(0);

    for (let i = monthsToShow - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthLabels.push(d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }));
    }

    docs.forEach(inv => {
        const invDate = new Date(inv.date || inv.$createdAt);
        const amount = Number(inv.totalAmount) || 0;
        const status = (inv.paymentStatus || 'pending').toLowerCase();

        for (let i = 0; i < monthsToShow; i++) {
            const targetDate = new Date(now.getFullYear(), now.getMonth() - (monthsToShow - 1 - i), 1);
            if (invDate.getFullYear() === targetDate.getFullYear() && invDate.getMonth() === targetDate.getMonth()) {
                if (status === 'paid') {
                    monthlyPaid[i] += amount;
                } else {
                    monthlyPending[i] += amount;
                }
                break;
            }
        }
    });

    if (revenueChart) {
        revenueChart.data.labels = monthLabels;
        revenueChart.data.datasets[0].data = monthlyPaid;
        revenueChart.data.datasets[1].data = monthlyPending;
        revenueChart.update(skipAnimation ? 'none' : undefined);
        return;
    }

    const ctx = canvas.getContext('2d');
    revenueChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: monthLabels,
            datasets: [
                {
                    label: 'Nominal Lunas (Rp)',
                    data: monthlyPaid,
                    backgroundColor: '#10b981',
                    borderRadius: 6,
                    hoverBackgroundColor: '#059669'
                },
                {
                    label: 'Nominal Belum Lunas (Rp)',
                    data: monthlyPending,
                    backgroundColor: '#f59e0b',
                    borderRadius: 6,
                    hoverBackgroundColor: '#d97706'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#64748b', font: { size: 12, weight: '600' } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${formatRupiah(context.raw)}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(226, 232, 240, 0.8)' },
                    ticks: {
                        color: '#64748b',
                        callback: function(val) {
                            if (val >= 1000000) return (val / 1000000) + ' Jt';
                            if (val >= 1000) return (val / 1000) + ' Rb';
                            return val;
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b' }
                }
            }
        }
    });
}

// Chart 2: Type Composition Donut
function renderTypeDonutChart(typeCounts, skipAnimation = false) {
    const canvas = document.getElementById('chart-type-donut');
    if (!canvas || typeof Chart === 'undefined') return;

    if (typeChart) {
        typeChart.data.datasets[0].data = [typeCounts.normal, typeCounts.rental];
        typeChart.update(skipAnimation ? 'none' : undefined);
        return;
    }

    const ctx = canvas.getContext('2d');
    typeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Invoice Reguler', 'Invoice Sewa (Rental)'],
            datasets: [{
                data: [typeCounts.normal, typeCounts.rental],
                backgroundColor: ['#4f46e5', '#ec4899'],
                borderColor: '#ffffff',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#64748b', font: { size: 12, weight: '500' } }
                }
            },
            cutout: '68%'
        }
    });
}

// Chart 3: Payment Status Donut
function renderPaymentDonutChart(paymentCounts, skipAnimation = false) {
    const canvas = document.getElementById('chart-payment-donut');
    if (!canvas || typeof Chart === 'undefined') return;

    if (paymentChart) {
        paymentChart.data.datasets[0].data = [paymentCounts.paid, paymentCounts.pending, paymentCounts.overdue];
        paymentChart.update(skipAnimation ? 'none' : undefined);
        return;
    }

    const ctx = canvas.getContext('2d');
    paymentChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Lunas', 'Belum Lunas', 'Jatuh Tempo'],
            datasets: [{
                data: [paymentCounts.paid, paymentCounts.pending, paymentCounts.overdue],
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                borderColor: '#ffffff',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#64748b', font: { size: 12, weight: '500' } }
                }
            },
            cutout: '68%'
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
                    <div class="top-client-amount">${formatRupiah(client.total)}</div>
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
                <div style="min-width:0; flex:1; overflow:hidden;">
                    <div class="new-client-name" title="${c.name}">${c.name}</div>
                    <div class="new-client-date"><i class="fa-solid fa-clock-rotate-left"></i> ${c.date.toLocaleDateString('id-ID')}</div>
                </div>
            </div>
            <div class="new-client-meta">
                <div class="top-client-amount">${formatRupiah(c.amount)}</div>
            </div>
        </div>
    `).join('');
}

// Section 5: Monthly Rekapitulasi Table
function renderMonthlyBreakdownTable(monthlySummary) {
    const tbody = document.getElementById('analytics-monthly-tbody');
    if (!tbody) return;

    const keys = Object.keys(monthlySummary).sort().reverse();
    if (keys.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Belum ada transaksi dalam periode ini</td></tr>';
        const tfoot = document.getElementById('analytics-monthly-tfoot');
        if (tfoot) tfoot.innerHTML = '';
        return;
    }

    let gTotal = 0, gNormal = 0, gRental = 0, gPaid = 0, gPending = 0, gCount = 0;

    tbody.innerHTML = keys.map(key => {
        const item = monthlySummary[key];
        const rate = item.total > 0 ? Math.round((item.paid / item.total) * 100) : 0;
        let badgeClass = 'badge-reguler';
        if (rate >= 80) badgeClass = 'badge-success';
        else if (rate >= 50) badgeClass = 'badge-warning';
        else badgeClass = 'badge-sewa';

        gTotal += item.total;
        gNormal += item.normal;
        gRental += item.rental;
        gPaid += item.paid;
        gPending += item.pending;
        gCount += item.count;

        return `
            <tr>
                <td><strong>${item.label}</strong></td>
                <td><strong>${formatRupiah(item.total)}</strong> <small class="text-muted">(${item.count})</small></td>
                <td>${formatRupiah(item.normal)}</td>
                <td>${formatRupiah(item.rental)}</td>
                <td style="color:#059669; font-weight:600;">${formatRupiah(item.paid)}</td>
                <td style="color:#dc2626; font-weight:600;">${formatRupiah(item.pending)}</td>
                <td><span class="badge ${badgeClass}">${rate}% Lunas</span></td>
            </tr>
        `;
    }).join('');

    const gRate = gTotal > 0 ? Math.round((gPaid / gTotal) * 100) : 0;
    let gBadgeClass = gRate >= 80 ? 'badge-success' : (gRate >= 50 ? 'badge-warning' : 'badge-sewa');

    let tfoot = document.getElementById('analytics-monthly-tfoot');
    const table = tbody.closest('table');
    if (table) {
        if (!tfoot) {
            tfoot = document.createElement('tfoot');
            tfoot.id = 'analytics-monthly-tfoot';
            table.appendChild(tfoot);
        }
        tfoot.innerHTML = `
            <tr style="background: var(--surface-hover); font-weight:700; border-top: 2px solid var(--border);">
                <td><strong>TOTAL KESELURUHAN</strong></td>
                <td><strong>${formatRupiah(gTotal)}</strong> <small class="text-muted">(${gCount})</small></td>
                <td>${formatRupiah(gNormal)}</td>
                <td>${formatRupiah(gRental)}</td>
                <td style="color:#059669; font-weight:700;">${formatRupiah(gPaid)}</td>
                <td style="color:#dc2626; font-weight:700;">${formatRupiah(gPending)}</td>
                <td><span class="badge ${gBadgeClass}">${gRate}% Overall</span></td>
            </tr>
        `;
    }
}

// Download Summary Rekap as PDF
async function downloadAnalyticsPDF() {
    console.log('Menjalankan downloadAnalyticsPDF...');

    const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || null);
    if (!jsPDFClass) {
        showToast('Library jsPDF belum terdistribusi. Silakan refresh halaman.', 'error');
        return;
    }

    showToast('Menyiapkan Laporan Rekap PDF...', 'info');

    try {
        const doc = new jsPDFClass({ unit: 'mm', format: 'a4', compress: true });

        const docs = (typeof statsData !== 'undefined' && statsData.length > 0) ? statsData : (typeof currentInvoices !== 'undefined' ? currentInvoices : []);
        const now = new Date();
        const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

        // Load logo with fast timeout safeguard
        let logoBase64 = null;
        try {
            logoBase64 = await loadImageAsBase64('./logo.png');
        } catch(e) {}

        // Calculate Stats
        let totalOmset = 0;
        let totalPaid = 0;
        let totalPending = 0;
        let paidCount = 0;
        let pendingCount = 0;
        let rentalCount = 0;
        let normalCount = 0;
        const clientTotals = {};
        const monthlySummary = {};

        docs.forEach(inv => {
            const amount = Number(inv.totalAmount) || 0;
            const status = String(inv.paymentStatus || 'pending').toLowerCase();
            const invDate = new Date(inv.date || inv.$createdAt || Date.now());
            const cName = Array.isArray(inv.clientName) ? inv.clientName[0] : (inv.clientName || 'Tidak Diketahui');

            totalOmset += amount;

            let isRental = false;
            try {
                const data = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items;
                const noteData = inv.note ? (typeof inv.note === 'string' ? JSON.parse(inv.note) : inv.note) : null;
                isRental = (noteData && noteData.type === 'rental') || (data && data.type === 'rental') || (inv.NoInvoice && String(inv.NoInvoice).toUpperCase().startsWith('SW'));
            } catch(e) {}

            if (isRental) rentalCount++;
            else normalCount++;

            if (status === 'paid') {
                totalPaid += amount;
                paidCount++;
            } else {
                totalPending += amount;
                pendingCount++;
            }

            if (!clientTotals[cName]) clientTotals[cName] = { total: 0, count: 0 };
            clientTotals[cName].total += amount;
            clientTotals[cName].count += 1;

            const monthKey = `${invDate.getFullYear()}-${String(invDate.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlySummary[monthKey]) {
                monthlySummary[monthKey] = {
                    label: invDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }),
                    total: 0, paid: 0, pending: 0, count: 0
                };
            }
            monthlySummary[monthKey].total += amount;
            monthlySummary[monthKey].count += 1;
            if (status === 'paid') monthlySummary[monthKey].paid += amount;
            else monthlySummary[monthKey].pending += amount;
        });

        // 1. Header Banner PDF with enlarged proportional logo sizing
        let startX = 15;
        if (logoBase64) {
            const dataUrl = logoBase64.dataUrl || String(logoBase64);
            const aspect = (logoBase64.aspect && logoBase64.aspect > 0) ? logoBase64.aspect : 1;

            // Target max height = 22mm, max width = 42mm for clear visibility
            let logoH = 22;
            let logoW = logoH * aspect;
            if (logoW > 42) {
                logoW = 42;
                logoH = logoW / aspect;
            }
            const logoY = 8 + (24 - logoH) / 2; // Center vertically in 24mm header block

            try {
                doc.addImage(dataUrl, 'PNG', 15, logoY, logoW, logoH);
                startX = 15 + logoW + 8; // 8mm gap after logo
            } catch(e) {
                console.warn('Could not render logo in PDF', e);
                startX = 15;
            }
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text('CV PUTRA BANUA MANDIRI', startX, 17);

        doc.setFontSize(9.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text('REKAPITULASI ANALITIK & LAPORAN KEUANGAN BISNIS', startX, 24);

        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(15, 34, 195, 34);

        // 2. Report Meta Box
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(15, 36, 180, 22, 3, 3, 'F');

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(79, 70, 229);
        doc.text('RINGKASAN EKSEKUTIF', 20, 43);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        doc.text(`Tanggal Dicetak: ${dateStr}`, 20, 50);
        const userName = (typeof currentUser !== 'undefined' && currentUser && currentUser.name) ? currentUser.name : 'Administrator';
        doc.text(`Dicetak Oleh: ${userName}`, 110, 43);
        doc.text(`Total Transaksi: ${docs.length} Invoice`, 110, 50);

        // AutoTable Runner Helper
        const runAutoTable = (options) => {
            try {
                if (typeof doc.autoTable === 'function') {
                    doc.autoTable(options);
                } else if (window.jspdf && typeof window.jspdf.autoTable === 'function') {
                    window.jspdf.autoTable(doc, options);
                } else if (typeof window.autoTable === 'function') {
                    window.autoTable(doc, options);
                }
            } catch(e) {
                console.warn('AutoTable call failed:', e);
            }
        };

        // 3. Key Metrics Table (Autotable)
        let lastY = 63;
        runAutoTable({
            startY: 63,
            head: [['Indikator Performa (KPI)', 'Nilai / Nominal', 'Keterangan']],
            body: [
                ['Total Omset Tagihan', formatRupiah(totalOmset, 'Rp ', true), `${docs.length} total invoice`],
                ['Total Pendapatan Terbayar (Lunas)', formatRupiah(totalPaid, 'Rp ', true), `${paidCount} invoice lunas`],
                ['Total Sisa Piutang (Belum Lunas/Jatuh Tempo)', formatRupiah(totalPending, 'Rp ', true), `${pendingCount} invoice belum lunas`],
                ['Tingkat Pelunasan (Collection Rate)', `${docs.length > 0 ? Math.round((paidCount / docs.length) * 100) : 0}%`, `${paidCount} dari ${docs.length} lunas`],
                ['Komposisi Tipe Transaksi', `${normalCount} Reguler / ${rentalCount} Sewa`, 'Distribusi tipe tagihan'],
                ['Total Pelanggan Aktif', `${Object.keys(clientTotals).length} Pelanggan`, 'Mitra bisnis terdaftar']
            ],
            theme: 'striped',
            headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold' },
            styles: { fontSize: 9, cellPadding: 3 }
        });
        lastY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : 120;

        // 4. Monthly Rekap Table
        const monthlyDataArr = Object.keys(monthlySummary).sort().reverse().map(k => {
            const item = monthlySummary[k];
            const rate = item.total > 0 ? Math.round((item.paid / item.total) * 100) : 0;
            return [
                item.label,
                `${item.count} Inv`,
                formatRupiah(item.total, 'Rp ', true),
                formatRupiah(item.paid, 'Rp ', true),
                formatRupiah(item.pending, 'Rp ', true),
                `${rate}%`
            ];
        });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.text('Detail Rekapitulasi per Bulan:', 15, lastY + 10);

        runAutoTable({
            startY: lastY + 14,
            head: [['Bulan / Tahun', 'Jumlah', 'Total Omset', 'Nominal Lunas', 'Sisa Piutang', 'Rate']],
            body: monthlyDataArr,
            theme: 'grid',
            headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
            styles: { fontSize: 8, cellPadding: 3 }
        });
        lastY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : lastY + 60;

        // 5. Top 5 Clients Table (SORTED NUMERICALLY)
        const topClientsArr = Object.entries(clientTotals)
            .sort((a, b) => b[1].total - a[1].total)
            .slice(0, 5)
            .map(([name, d]) => [name, `${d.count} Invoice`, formatRupiah(d.total, 'Rp ', true)]);

        if (lastY + 45 > 280) {
            doc.addPage();
            lastY = 15;
        } else {
            lastY = lastY + 10;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.text('Top 5 Pelanggan Paling Aktif:', 15, lastY);

        runAutoTable({
            startY: lastY + 4,
            head: [['Nama Pelanggan', 'Jumlah Invoice', 'Total Transaksi']],
            body: topClientsArr,
            theme: 'striped',
            headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: 'bold' },
            styles: { fontSize: 8.5, cellPadding: 3 }
        });

        // Footer Page Numbers
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(148, 163, 184);
            doc.text(`CV PUTRA BANUA MANDIRI — Laporan Rekapitulasi Analitik — Halaman ${i} dari ${pageCount}`, 15, 290);
        }

        // Save PDF
        const filename = `Rekap_Analitik_PBM_${now.toISOString().slice(0,10)}.pdf`;
        doc.save(filename);
        showToast('Laporan Rekap PDF berhasil di-download!', 'success');

        if (typeof ActivityLog !== 'undefined') {
            ActivityLog.add('pdf', 'Download Rekap PDF Analitik', `Laporan rekap keuangan berhasil di-download (${filename})`);
        }
    } catch(err) {
        console.error('Error generating analytics PDF:', err);
        showToast('Gagal memproses Rekap PDF: ' + err.message, 'error');
    }
}
window.downloadAnalyticsPDF = downloadAnalyticsPDF;



// ══════════════════════════════════════════════════════
//  BAPB — BERITA ACARA PENGEMBALIAN BARANG
// ══════════════════════════════════════════════════════

function generateNextBapbNumber() {
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var prefix = 'BAPB/PBM/' + year + '/' + month + '/';

    var maxSeq = 0;

    // Scan local database store
    try {
        var localDb = JSON.parse(localStorage.getItem('pbm_bapb_db') || '[]');
        if (Array.isArray(localDb)) {
            localDb.forEach(function(b) {
                if (b && b.number) {
                    var match = b.number.match(/(\d+)\s*$/);
                    if (match) {
                        var seq = parseInt(match[1], 10);
                        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
                    }
                }
            });
        }
    } catch(e) {}

    // Scan Activity Log
    try {
        if (typeof ActivityLog !== 'undefined' && Array.isArray(ActivityLog.logs)) {
            ActivityLog.logs.forEach(function(log) {
                if (log && log.actionTarget && log.actionTarget.includes('BAPB')) {
                    var match = log.actionTarget.match(/(\d+)\s*$/);
                    if (match) {
                        var seq = parseInt(match[1], 10);
                        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
                    }
                }
            });
        }
    } catch(e) {}

    var nextSeq = String(maxSeq + 1).padStart(3, '0');
    return prefix + nextSeq;
}
window.generateNextBapbNumber = generateNextBapbNumber;

function showBapbView() {
    try {
        switchView('bapb');
    } catch(e) {
        console.error("switchView failed:", e);
    }
    try {
        populateBapbInvoiceSelect();
        var dateEl = document.getElementById('bapb-date');
        if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
        var numEl = document.getElementById('bapb-number');
        if (numEl && !numEl.value) {
            numEl.value = generateNextBapbNumber();
        }
        var tbody = document.getElementById('bapb-items-tbody');
        if (tbody && tbody.rows.length === 0) addBapbItemRow();

        // Render history table
        renderBapbHistoryTable();

        // Sync BAPB data from Appwrite Cloud Database across devices
        syncBapbFromAppwriteCloud();
    } catch(err) {
        console.error("Error in showBapbView:", err);
    }
}
window.showBapbView = showBapbView;

async function syncBapbFromAppwriteCloud() {
    if (typeof API === 'undefined' || !API.getLogs) return;
    try {
        var docs = await API.getLogs(200);
        if (!docs || !Array.isArray(docs)) return;
        var existingLocal = [];
        try { existingLocal = JSON.parse(localStorage.getItem('pbm_bapb_db') || '[]'); } catch(e){}
        var updated = false;

        docs.forEach(function(log) {
            var target = log.actionTarget || log.label || '';
            var detail = log.detail || log.details || '';
            if (target.includes('BAPB') && detail && detail.includes('{')) {
                try {
                    var jsonStart = detail.indexOf('{');
                    if (jsonStart >= 0) {
                        var bData = JSON.parse(detail.substring(jsonStart));
                        if (bData && bData.number) {
                            var exists = existingLocal.some(function(b){ return b.number === bData.number; });
                            if (!exists) {
                                existingLocal.push(bData);
                                updated = true;
                            }
                        }
                    }
                } catch(err){}
            }
        });

        if (updated) {
            existingLocal.sort(function(a,b){ return new Date(b.date || b.savedAt || 0) - new Date(a.date || a.savedAt || 0); });
            localStorage.setItem('pbm_bapb_db', JSON.stringify(existingLocal));
            if (typeof renderBapbHistoryTable === 'function') {
                renderBapbHistoryTable();
            }
            var numEl = document.getElementById('bapb-number');
            if (numEl && typeof generateNextBapbNumber === 'function') {
                numEl.value = generateNextBapbNumber();
            }
        }
    } catch(err) {
        console.warn("Sync BAPB from Appwrite Cloud error:", err);
    }
}
window.syncBapbFromAppwriteCloud = syncBapbFromAppwriteCloud;

function populateBapbInvoiceSelect() {
    try {
        var select = document.getElementById('bapb-select-invoice');
        if (!select) return;
        var allInvoices = [];
        if (typeof statsData !== 'undefined' && Array.isArray(statsData) && statsData.length > 0) {
            allInvoices = statsData;
        } else if (typeof currentInvoices !== 'undefined' && Array.isArray(currentInvoices)) {
            allInvoices = currentInvoices;
        }
        var rentalInvoices = allInvoices.filter(function(inv) {
            try {
                if (!inv) return false;
                var note = inv.note ? (typeof inv.note === 'string' ? JSON.parse(inv.note) : inv.note) : null;
                var data = inv.items ? (typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items) : null;
                return (note && note.type === 'rental') || (data && data.type === 'rental') ||
                       (inv.NoInvoice && String(inv.NoInvoice).toUpperCase().startsWith('SW')) ||
                       Boolean(note && note.rental && (note.rental.awal || note.rental.akhir));
            } catch(e) { return false; }
        });
        rentalInvoices.sort(function(a,b){ return new Date(b.date||b.$createdAt||0)-new Date(a.date||a.$createdAt||0); });
        select.innerHTML = '<option value="">-- Pilih Invoice Sewa --</option>';
        rentalInvoices.forEach(function(inv) {
            var clientName = Array.isArray(inv.clientName) ? inv.clientName[0] : (inv.clientName || '-');
            var opt = document.createElement('option');
            opt.value = inv.$id || '';
            opt.textContent = (inv.NoInvoice || 'SW') + ' \u2014 ' + clientName;
            select.appendChild(opt);
        });
        if (rentalInvoices.length === 0) {
            var opt = document.createElement('option');
            opt.disabled = true;
            opt.textContent = '(Tidak ada invoice sewa tersedia)';
            select.appendChild(opt);
        }
    } catch(err) {
        console.error("Error in populateBapbInvoiceSelect:", err);
    }
}
window.populateBapbInvoiceSelect = populateBapbInvoiceSelect;

window.showBapbMode = function(mode) {
    _bapbCurrentMode = mode;
    var sourceCard = document.querySelector('.bapb-source-card');
    if (sourceCard) sourceCard.style.display = mode === 'invoice' ? '' : 'none';
    if (mode === 'manual') {
        var sel = document.getElementById('bapb-select-invoice');
        if (sel) sel.value = '';
        ['bapb-pihak2-client','bapb-pihak2-address','bapb-pihak2-name','bapb-ref-invoice'].forEach(function(id){
            var el = document.getElementById(id); if (el) el.value = '';
        });
        var tbody = document.getElementById('bapb-items-tbody');
        if (tbody) { tbody.innerHTML = ''; _bapbItemCounter = 0; addBapbItemRow(); }
    }
    var btns = document.querySelectorAll('.analytics-actions-right .btn');
    btns.forEach(function(btn){ btn.classList.remove('btn-primary'); });
    var activeIdx = mode === 'invoice' ? 0 : 1;
    if (btns[activeIdx]) btns[activeIdx].classList.add('btn-primary');
};

window.handleBapbInvoiceSelect = function(invoiceId) {
    if (!invoiceId) return;
    var allInvoices = (statsData && statsData.length > 0) ? statsData : currentInvoices;
    var inv = allInvoices.find(function(i){ return i.$id === invoiceId; });
    if (!inv) { showToast('Invoice tidak ditemukan.', 'warning'); return; }
    var noteData = null, itemsData = null;
    try { noteData = inv.note ? (typeof inv.note === 'string' ? JSON.parse(inv.note) : inv.note) : null; } catch(e){}
    try { itemsData = inv.items ? (typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items) : null; } catch(e){}
    var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('bapb-ref-invoice', inv.NoInvoice);
    var clientName = Array.isArray(inv.clientName) ? inv.clientName[0] : (inv.clientName || '');
    var clientAddr = Array.isArray(inv.clientAddress) ? inv.clientAddress[0] : (inv.clientAddress || '');
    setVal('bapb-pihak2-client', clientName);
    setVal('bapb-pihak2-address', clientAddr || (noteData && noteData.site) || '');
    setVal('bapb-pihak2-name', (noteData && noteData.picName) || '');
    var tbody = document.getElementById('bapb-items-tbody');
    if (!tbody) return;
    tbody.innerHTML = ''; _bapbItemCounter = 0;
    var itemArr = [];
    if (itemsData) {
        if (Array.isArray(itemsData)) itemArr = itemsData;
        else if (itemsData.itemList && Array.isArray(itemsData.itemList)) itemArr = itemsData.itemList;
    }
    if (itemArr.length === 0 && noteData && Array.isArray(noteData.itemList)) itemArr = noteData.itemList;
    if (itemArr.length > 0) {
        itemArr.forEach(function(item){
            addBapbItemRow({ name: item.name||item.description||'', qty: item.qty||item.quantity||1, unit: item.unit||item.satuan||'Unit', condition: 'Baik', notes: '' });
        });
    } else { addBapbItemRow(); }
    showToast('Data dari Invoice ' + inv.NoInvoice + ' berhasil dimuat!', 'success');
};

function addBapbItemRow(preset) {
    preset = preset || {};
    var tbody = document.getElementById('bapb-items-tbody');
    if (!tbody) return;
    var idx = tbody.rows.length + 1;
    var conditions = ['Baik','Rusak Ringan','Rusak Berat','Hilang'];
    var conditionOpts = conditions.map(function(c){
        return '<option value="'+c+'"'+(((preset.condition||'Baik')===c)?' selected':'')+'>'+c+'</option>';
    }).join('');
    var tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border)';
    tr.innerHTML = '<td style="text-align:center;color:var(--text-muted);font-size:13px;padding:8px 6px;font-weight:600;">'+idx+'</td>' +
        '<td style="padding:6px 4px;"><input type="text" class="input-field" style="width:100%;min-width:140px;font-size:13px;" placeholder="Nama barang/peralatan" value="'+(preset.name||'').replace(/"/g, '&quot;')+'" required /></td>' +
        '<td style="padding:6px 4px;"><input type="number" class="input-field" style="width:100%;font-size:13px;" min="0.01" step="0.01" value="'+(preset.qty||1)+'" /></td>' +
        '<td style="padding:6px 4px;"><input type="text" class="input-field" style="width:100%;font-size:13px;" placeholder="Unit" value="'+(preset.unit||'Unit').replace(/"/g, '&quot;')+'" /></td>' +
        '<td style="padding:6px 4px;"><select class="input-field" style="width:100%;font-size:12px;font-weight:600;">'+conditionOpts+'</select></td>' +
        '<td style="padding:6px 4px;"><input type="text" class="input-field" style="width:100%;font-size:12px;" placeholder="Catatan..." value="'+(preset.notes||'').replace(/"/g, '&quot;')+'" /></td>' +
        '<td style="text-align:center;padding:6px 4px;"><button type="button" class="btn btn-danger btn-action" onclick="removeBapbItemRow(this)" title="Hapus baris" style="padding:4px 8px;"><i class="fa-solid fa-trash"></i></button></td>';
    tbody.appendChild(tr);
    tbody.querySelectorAll('tr').forEach(function(r, i){ if (r.cells[0]) r.cells[0].textContent = i+1; });
    return tr;
}
window.addBapbItemRow = addBapbItemRow;

window.removeBapbItemRow = function(btn) {
    var tr = btn.closest('tr');
    if (!tr) return;
    var tbody = tr.closest('tbody');
    if (tbody && tbody.rows.length <= 1) { showToast('Harus ada minimal 1 barang dalam daftar.', 'warning'); return; }
    tr.remove();
    tbody.querySelectorAll('tr').forEach(function(r, i){ if (r.cells[0]) r.cells[0].textContent = i+1; });
};

function collectBapbData() {
    var getVal = function(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    var items = [];
    var tbody = document.getElementById('bapb-items-tbody');
    if (tbody) {
        tbody.querySelectorAll('tr').forEach(function(tr) {
            var inp = tr.querySelectorAll('input, select');
            if (inp.length >= 5) {
                items.push({ name: (inp[0]?inp[0].value:'').trim()||'-', qty: parseFloat(inp[1]?inp[1].value:1)||1,
                    unit: (inp[2]?inp[2].value:'').trim()||'Unit', condition: inp[3]?inp[3].value:'Baik', notes: (inp[4]?inp[4].value:'').trim() });
            }
        });
    }
    return { number: getVal('bapb-number'), date: getVal('bapb-date'), refInvoice: getVal('bapb-ref-invoice'),
        pihak1Company: getVal('bapb-pihak1-company')||'CV PUTRA BANUA MANDIRI', pihak1Name: getVal('bapb-pihak1-name'),
        pihak1Role: getVal('bapb-pihak1-role'), pihak2Client: getVal('bapb-pihak2-client'),
        pihak2Address: getVal('bapb-pihak2-address'), pihak2Name: getVal('bapb-pihak2-name'),
        pihak2Role: getVal('bapb-pihak2-role'), notes: getVal('bapb-notes'), items: items };
}

window.handleBapbSubmit = async function(e) {
    e.preventDefault();
    var data = collectBapbData();
    if (!data.number)       { showToast('No. Berita Acara wajib diisi.', 'error'); return; }
    if (!data.date)         { showToast('Tanggal Pengembalian wajib diisi.', 'error'); return; }
    if (!data.pihak1Name)   { showToast('Nama Petugas wajib diisi.', 'error'); return; }
    if (!data.pihak2Client) { showToast('Nama Klien wajib diisi.', 'error'); return; }
    if (!data.items.length) { showToast('Tambahkan minimal 1 barang ke daftar.', 'error'); return; }
    var submitBtn = document.getElementById('bapb-submit-btn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
    try {
        // Save to BAPB local database store
        var existingBapb = [];
        try { existingBapb = JSON.parse(localStorage.getItem('pbm_bapb_db') || '[]'); } catch(err){}
        data.savedAt = new Date().toISOString();
        var existIndex = existingBapb.findIndex(function(b){ return b.number === data.number; });
        if (existIndex >= 0) existingBapb[existIndex] = data;
        else existingBapb.unshift(data);
        localStorage.setItem('pbm_bapb_db', JSON.stringify(existingBapb));

        // Save to Activity Log (which syncs directly to Appwrite Cloud Database)
        if (typeof ActivityLog !== 'undefined') {
            ActivityLog.add('create_invoice', 'BAPB ' + data.number, 'Klien: ' + data.pihak2Client + ' | ' + data.items.length + ' item | ' + JSON.stringify(data));
        }
        showToast('Berita Acara ' + data.number + ' berhasil disimpan ke database!', 'success');
        renderBapbHistoryTable();
        setTimeout(function(){ window.downloadCurrentBapbPDF(); }, 600);
    } catch(err) {
        console.error('BAPB submit error:', err);
        showToast('Gagal menyimpan: ' + err.message, 'error');
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Berita Acara'; }
    }
};

window.downloadCurrentBapbPDF = async function() {
    var data = collectBapbData();
    if (!data.number)       { showToast('No. Berita Acara wajib diisi sebelum download PDF.', 'warning'); return; }
    if (!data.items.length) { showToast('Tambahkan minimal 1 barang sebelum download PDF.', 'warning'); return; }
    try {
        var fn = window.generateBapbPDF;
        if (!fn) { showToast('Fungsi generateBapbPDF belum dimuat.', 'error'); return; }
        await fn(data);
        if (typeof ActivityLog !== 'undefined') ActivityLog.add('download_pdf', 'PDF BAPB ' + data.number, 'Klien: ' + data.pihak2Client);
    } catch(err) {
        console.error('BAPB PDF error:', err);
        showToast('Gagal generate PDF: ' + err.message, 'error');
    }
};

window.resetBapbForm = async function() {
    var confirmed = await showConfirm('Reset Form Berita Acara?', 'Semua data yang sudah diisi akan dihapus. Yakin ingin mereset?',
        { type: 'danger', confirmText: 'Ya, Reset', icon: 'fa-rotate-left' });
    if (!confirmed) return;
    var form = document.getElementById('bapb-form'); if (form) form.reset();
    var sel = document.getElementById('bapb-select-invoice'); if (sel) sel.value = '';
    var tbody = document.getElementById('bapb-items-tbody');
    if (tbody) { tbody.innerHTML = ''; _bapbItemCounter = 0; addBapbItemRow(); }
    var dateEl = document.getElementById('bapb-date'); if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
    var numEl = document.getElementById('bapb-number');
    if (numEl) { numEl.value = generateNextBapbNumber(); }
    showToast('Form Berita Acara berhasil direset.', 'info');
};

// ── BAPB History Table Functions ─────────────────────────

function renderBapbHistoryTable() {
    var tbody = document.getElementById('bapb-history-tbody');
    if (!tbody) return;

    var searchInput = document.getElementById('bapb-history-search');
    var query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    var bapbList = [];
    try {
        bapbList = JSON.parse(localStorage.getItem('pbm_bapb_db') || '[]');
    } catch(e) { bapbList = []; }

    if (query) {
        bapbList = bapbList.filter(function(item) {
            return (item.number && item.number.toLowerCase().includes(query)) ||
                   (item.pihak2Client && item.pihak2Client.toLowerCase().includes(query)) ||
                   (item.refInvoice && item.refInvoice.toLowerCase().includes(query)) ||
                   (item.pihak1Name && item.pihak1Name.toLowerCase().includes(query));
        });
    }

    if (!bapbList || bapbList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 32px; color: var(--text-muted);">' +
            '<i class="fa-solid fa-folder-open" style="font-size: 2.2rem; margin-bottom: 8px; opacity: 0.35; display: block;"></i>' +
            'Belum ada riwayat Berita Acara tersimpan.' +
            '</td></tr>';
        return;
    }

    var html = '';
    bapbList.forEach(function(item, idx) {
        var itemCount = item.items ? item.items.length : 0;
        var dateFormatted = item.date ? new Date(item.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
        var encodedItem = encodeURIComponent(JSON.stringify(item));

        html += '<tr>' +
            '<td style="text-align:center; font-weight:600; color:var(--text-muted);">' + (idx + 1) + '</td>' +
            '<td><span class="invoice-badge" style="background:rgba(99,102,241,0.1); color:#6366f1; font-weight:700; padding:4px 10px; border-radius:6px; font-size:12px;">' + (item.number || '-') + '</span></td>' +
            '<td><i class="fa-regular fa-calendar" style="margin-right:5px; color:var(--text-muted);"></i>' + dateFormatted + '</td>' +
            '<td>' + (item.refInvoice ? '<span class="badge" style="background:rgba(16,185,129,0.1); color:#10b981; font-weight:600;">' + item.refInvoice + '</span>' : '<span style="color:var(--text-muted);">-</span>') + '</td>' +
            '<td><div style="font-weight:600; font-size:13px;">' + (item.pihak1Company || 'CV PUTRA BANUA MANDIRI') + '</div><div style="font-size:11px; color:var(--text-muted);">' + (item.pihak1Name || '') + '</div></td>' +
            '<td><div style="font-weight:600; font-size:13px; color:var(--text-main);">' + (item.pihak2Client || '-') + '</div><div style="font-size:11px; color:var(--text-muted);">' + (item.pihak2Name || '') + '</div></td>' +
            '<td style="text-align:center;"><span class="badge" style="background:rgba(245,158,11,0.12); color:#f59e0b; font-weight:700; font-size:11px;">' + itemCount + ' Item</span></td>' +
            '<td style="text-align:center;">' +
                '<div style="display:flex; gap:6px; justify-content:center;">' +
                    '<button type="button" class="btn btn-sm btn-outline" style="padding:4px 8px;" onclick="loadBapbToForm(\'' + encodedItem + '\')" title="Muat ke Form / Edit"><i class="fa-solid fa-folder-open"></i></button>' +
                    '<button type="button" class="btn btn-sm btn-rekap-pdf" style="padding:4px 8px;" onclick="downloadBapbPdfFromHistory(\'' + encodedItem + '\')" title="Download PDF"><i class="fa-solid fa-file-pdf"></i></button>' +
                    '<button type="button" class="btn btn-sm btn-danger" style="padding:4px 8px;" onclick="deleteBapbRecord(\'' + (item.number||'') + '\')" title="Hapus Riwayat"><i class="fa-solid fa-trash"></i></button>' +
                '</div>' +
            '</td>' +
        '</tr>';
    });

    tbody.innerHTML = html;
}
window.renderBapbHistoryTable = renderBapbHistoryTable;

window.loadBapbToForm = function(encodedItem) {
    try {
        var item = JSON.parse(decodeURIComponent(encodedItem));
        if (!item) return;
        var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };
        setVal('bapb-number', item.number);
        setVal('bapb-date', item.date);
        setVal('bapb-ref-invoice', item.refInvoice);
        setVal('bapb-pihak1-company', item.pihak1Company);
        setVal('bapb-pihak1-name', item.pihak1Name);
        setVal('bapb-pihak1-role', item.pihak1Role);
        setVal('bapb-pihak2-client', item.pihak2Client);
        setVal('bapb-pihak2-address', item.pihak2Address);
        setVal('bapb-pihak2-name', item.pihak2Name);
        setVal('bapb-pihak2-role', item.pihak2Role);
        setVal('bapb-notes', item.notes);

        var tbody = document.getElementById('bapb-items-tbody');
        if (tbody) {
            tbody.innerHTML = '';
            _bapbItemCounter = 0;
            if (item.items && Array.isArray(item.items) && item.items.length > 0) {
                item.items.forEach(function(it) {
                    addBapbItemRow(it);
                });
            } else {
                addBapbItemRow();
            }
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast('Data BA ' + item.number + ' dimuat ke form.', 'info');
    } catch(err) {
        console.error('Error loading BAPB to form:', err);
        showToast('Gagal memuat data BA.', 'error');
    }
};

window.downloadBapbPdfFromHistory = function(encodedItem) {
    try {
        var item = JSON.parse(decodeURIComponent(encodedItem));
        if (!item) return;
        if (typeof generateBapbPDF === 'function') {
            generateBapbPDF(item);
        }
    } catch(err) {
        console.error('Error downloading BAPB PDF from history:', err);
        showToast('Gagal memuat PDF.', 'error');
    }
};

window.deleteBapbRecord = async function(number) {
    if (!number) return;
    var confirmed = await showConfirm('Hapus Riwayat BA?', 'Apakah Anda yakin ingin menghapus ' + number + ' dari riwayat database?',
        { type: 'danger', confirmText: 'Ya, Hapus', icon: 'fa-trash' });
    if (!confirmed) return;
    try {
        var db = JSON.parse(localStorage.getItem('pbm_bapb_db') || '[]');
        db = db.filter(function(b){ return b.number !== number; });
        localStorage.setItem('pbm_bapb_db', JSON.stringify(db));
        showToast('Riwayat ' + number + ' berhasil dihapus.', 'success');
        renderBapbHistoryTable();
    } catch(err) {
        showToast('Gagal menghapus riwayat.', 'error');
    }
};
