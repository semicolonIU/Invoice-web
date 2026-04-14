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

const views = {
    dashboard: document.getElementById('view-dashboard'),
    create: document.getElementById('view-create'),
    settings: document.getElementById('view-settings')
};
const navs = {
    dashboard: document.getElementById('nav-dashboard'),
    create: document.getElementById('nav-create'),
    settings: document.getElementById('nav-settings')
};

function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

function switchView(viewName) {
    Object.values(views).forEach(v => v.style.display = 'none');
    Object.values(navs).forEach(n => n.classList.remove('active'));
    views[viewName].style.display = 'block';
    if(navs[viewName]) navs[viewName].classList.add('active');
    closeMobileSidebar();
}

document.getElementById('nav-dashboard').addEventListener('click', () => { switchView('dashboard'); loadInvoices(1); });
document.getElementById('nav-create').addEventListener('click', () => { showCreate('normal'); });
document.getElementById('nav-create-rental').addEventListener('click', () => { showCreate('rental'); });
document.getElementById('nav-settings').addEventListener('click', () => { switchView('settings'); initSettings(); });

function showDashboard() { switchView('dashboard'); loadInvoices(1); }

function showCreate(type = 'normal') { 
    editingId = null;
    switchView('create'); 
    resetForm(); 
    
    const isRental = type === 'rental';
    document.getElementById('inv-type').value = type;
    document.getElementById('form-title').textContent = isRental ? 'Buat Invoice Sewa' : 'Buat Invoice Reguler';
    document.getElementById('submit-btn').innerHTML = '<i class="fa-solid fa-save"></i> Simpan ke Appwrite';
    
    // Toggle fields visibility
    document.querySelectorAll('.rental-only').forEach(el => el.style.display = isRental ? 'flex' : 'none');
    document.querySelectorAll('.normal-only').forEach(el => el.style.display = isRental ? 'none' : 'block');
    document.querySelectorAll('.item-extra-col').forEach(el => el.style.display = isRental ? 'none' : 'block');
    document.querySelectorAll('.rental-desc-col').forEach(el => el.style.display = isRental ? 'block' : 'none');
    
    // Auto-prefix No. Invoice
    window.generateInvNumber(isRental ? 'SW' : 'INV');
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

// Inisialisasi Settings
function initSettings() {
    document.getElementById('setup-endpoint').value = localStorage.getItem('aw_endpoint') || 'https://sgp.cloud.appwrite.io/v1';
    document.getElementById('setup-project').value = localStorage.getItem('aw_project') || '69d9eeb20034b5287618';
    document.getElementById('setup-database').value = localStorage.getItem('aw_database') || '69d9f15c0001694b8ef4';
    document.getElementById('setup-collection').value = localStorage.getItem('aw_collection') || 'invoice';
}

document.getElementById('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    localStorage.setItem('aw_endpoint', document.getElementById('setup-endpoint').value);
    localStorage.setItem('aw_project', document.getElementById('setup-project').value);
    localStorage.setItem('aw_database', document.getElementById('setup-database').value);
    localStorage.setItem('aw_collection', document.getElementById('setup-collection').value);
    
    alert('Pengaturan Tersimpan! Halaman akan dimuat ulang.');
    window.location.reload();
});

// Load Invoices
async function loadInvoices(page = 1) {
    const tbody = document.getElementById('invoice-list');
    currentPage = page;
    const offset = (page - 1) * itemsPerPage;
    const searchQuery = document.getElementById('search-input').value;
    
    try {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center loading-text"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data tagihan...</td></tr>';
        
        const result = await API.getInvoices(itemsPerPage, offset, searchQuery);
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
    } catch (e) {
        console.error("Error loading stats:", e);
        // Fallback: gunakan data yang sudah ter-render sebelumnya
        if (currentInvoices.length > 0) {
            refreshMetadata(currentInvoices);
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
        span.onclick = () => loadInvoices(i);
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
        loadInvoices(newPage);
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
            let itemsArray = itemsData?.itemList || (Array.isArray(itemsData) ? itemsData : []);
            
            itemsArray.forEach(i => {
                if (i.name) freshItems[i.name] = i.price || 0;
                if (i.tb && String(i.tb).toUpperCase() !== "NO-ENTRY") freshTb.add(String(i.tb));
                if (i.bg && String(i.bg).toUpperCase() !== "NO-ENTRY") freshBg.add(String(i.bg));
            });

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
    loadInvoices(1); // Real-time search with pagination
}

window.sortInvoices = function() {
    renderInvoiceTable(currentInvoices);
}

function renderInvoiceTable(docs) {
    const tbody = document.getElementById('invoice-list');
    const sortMethod = document.getElementById('sort-select').value;
    
    // Clone and Sort
    let items = [...docs];
    items.sort((a, b) => {
        if (sortMethod === 'createdAt') {
            return new Date(b.$createdAt) - new Date(a.$createdAt);
        } else if (sortMethod === 'dateNewest') {
            return new Date(b.date) - new Date(a.date);
        } else if (sortMethod === 'dateOldest') {
            return new Date(a.date) - new Date(b.date);
        }
        return 0;
    });

    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:var(--text-muted)">Data tidak ditemukan.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    items.forEach(invoice => {
        let isRental = false;
        let itemKeterangan = '-';
        try {
            const data = typeof invoice.items === 'string' ? JSON.parse(invoice.items) : invoice.items;
            isRental = data.type === 'rental';
            const arr = data.itemList || (Array.isArray(data) ? data : []);
            itemKeterangan = arr.map(i => i.name).join(', ') || '-';
            if (itemKeterangan.length > 50) itemKeterangan = itemKeterangan.substring(0, 50) + '...';
        } catch(e) {}

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
    document.querySelectorAll('.item-row').forEach(row => {
        items.push({
            name:  row.querySelector('.item-name').value,
            qty:   Number(row.querySelector('.item-qty').value),
            price: Number(row.querySelector('.item-price').value),
            tb:    row.querySelector('.item-tb').value.trim() || "NO-ENTRY",
            bg:    row.querySelector('.item-bg').value.trim() || "NO-ENTRY",
            desc:  row.querySelector('.item-desc') ? row.querySelector('.item-desc').value.trim() : ""
        });
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
        items:         JSON.stringify({
            type:     typeValue,
            rental:   { awal: sewaAwal, akhir: sewaAkhir },
            itemList: items,
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
            alert('Sukses: Invoice berhasil diperbarui!');
        } else {
            await API.createInvoice(invoiceData);
            alert('Sukses: Invoice berhasil direkam!');
        }

        editingId = null;
        statsData = []; // Reset stats cache to force reload
        showDashboard();
    } catch (e) {
        alert('Error menyimpan ke Appwrite: ' + e.message);
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
    try {
        const obj = typeof invoice.items === 'string' ? JSON.parse(invoice.items) : invoice.items;
        invType = obj.type || 'normal';
        rentalData = obj.rental || rentalData;
    } catch(e) {}

    showCreate(invType); // Switch view and reset form based on type
    editingId = id; // re-set because showCreate resets it

    document.getElementById('form-title').textContent = invType === 'rental' ? 'Edit Invoice Sewa' : 'Edit Invoice Reguler';
    document.getElementById('submit-btn').innerHTML = '<i class="fa-solid fa-save"></i> Perbarui Invoice';

    // Populate common data
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
    
    let itemsArray = [];
    let flags = { showInv: true, showPo: true, showSite: true, showDate: true };
    
    try {
        const obj = typeof invoice.items === 'string' ? JSON.parse(invoice.items) : invoice.items;
        if (obj && obj.itemList) {
            itemsArray = obj.itemList;
            flags = obj.flags || flags;
        } else {
            itemsArray = obj || [];
        }
    } catch(e) { console.error(e); }

    // Re-apply flags from saved data
    document.getElementById('chk-show-inv').checked  = (flags.showInv !== false);
    document.getElementById('chk-show-po').checked   = (flags.showPo !== false);
    document.getElementById('chk-show-site').checked = (flags.showSite !== false);

    if (itemsArray.length > 0) {
        itemsArray.forEach(item => {
            itemCount++;
            const row = createItemRow(itemCount);
            
            row.querySelector('.item-name').value  = item.name || '';
            row.querySelector('.item-qty').value   = item.qty || 1;
            row.querySelector('.item-price').value = item.price || 0;
            row.querySelector('.item-tb').value    = (item.tb && item.tb !== "NO-ENTRY") ? item.tb : '';
            row.querySelector('.item-bg').value    = (item.bg && item.bg !== "NO-ENTRY") ? item.bg : '';
            if(row.querySelector('.item-desc')) row.querySelector('.item-desc').value = item.desc || '';
            document.getElementById('items-container').appendChild(row);
        });
    } else {
        addItemRow();
    }
    
    calculateTotal();
}

window.deleteInvoice = async function(id) {
    if(confirm('Data invoice ini akan dihapus secara permanen. Lanjutkan?')) {
        try {
            await API.deleteInvoice(id);
            statsData = [];
            loadInvoices(currentPage);
        } catch(e) {
            alert('Gagal menghapus: ' + e.message);
        }
    }
}

window.updatePaymentStatus = async function(id, newStatus) {
    try {
        await API.updateInvoiceStatus(id, newStatus);
        // Optionally show a toast or alert, or just let it be silent
    } catch (e) {
        alert('Gagal mengupdate status: ' + e.message);
        loadInvoices(); // reload to reset the select to previous state
    }
}

window.downloadPDF = function(id) {
    const invoice = currentInvoices.find(inv => inv.$id === id);
    if(invoice) {
        window.generatePDF(invoice, 'download');
        if (invoice.paymentStatus === 'pending') {
            updatePaymentStatus(id, 'paid');
        }
    }
}

window.nativeShare = async function(id) {
    const invoice = currentInvoices.find(inv => inv.$id === id);
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
            alert('Browser/Ponsel Anda tidak memiliki dukungan membagikan file PDF secara langsung. Membuka opsi Download...');
            window.generatePDF(invoice, 'download');
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            alert('Gagal membagikan dokumen: ' + e.message);
        }
    }
}

window.previewInvoice = async function() {
    const data = getInvoiceFormData();
    const btn = document.getElementById('preview-btn');
    const originalText = btn.innerHTML;
    
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
    btn.disabled = true;
    
    try {
        const blobUrl = await window.generatePDF(data, 'preview');
        document.getElementById('preview-iframe').src = blobUrl;
        document.getElementById('preview-modal').style.display = 'flex';
    } catch (e) {
        alert('Gagal membuat pratinjau: ' + e.message);
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

window.downloadPreview = function() {
    const iframe = document.getElementById('preview-iframe');
    if (iframe.src.startsWith('blob:')) {
        const data = getInvoiceFormData();
        window.generatePDF(data, 'download'); // Trigger actual download
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
    if (confirm('Anda yakin ingin keluar?')) {
        try {
            await API.logout();
            window.location.reload();
        } catch (e) {
            alert('Gagal logout: ' + e.message);
        }
    }
};

function initAndLoad() {
    initSettings();
    if(localStorage.getItem('aw_database')) {
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
