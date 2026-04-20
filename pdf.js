// Helper: load image as base64 for jsPDF
function loadImageAsBase64(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = function () {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('Gagal memuat logo'));
        img.src = url + '?t=' + Date.now();
    });
}

window.generatePDF = async function (invoiceData, action = 'download') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        unit: 'mm',
        format: 'a4',
        compress: true // Mengaktifkan kompresi agar file tetap kecil (under 1MB)
    });

    // === ECO-FRIENDLY PALETTE ===
    const ink = [45, 45, 45];         // Very dark gray (less ink bleeding)
    const headerBg = [255, 255, 255];  // Pure white
    const accentBar = [100, 100, 100]; // Lighter accent
    const midGray = [120, 120, 120];   // Secondary text
    const lineGray = [210, 210, 210];  // Subtle borders
    const rowAlt = [252, 252, 252];    // Barely noticeable row stripping
    const boxBg = [250, 250, 250];    // Very light background
    const darkText = [30, 30, 30];     // Primary text
    const white = [255, 255, 255];
    const lightFill = [240, 242, 245]; // New: Light slate for headers/boxes

    const pageW = 210;
    const pageH = 297;
    const marginL = 15;
    const marginR = 15;

    // ================================================
    // HEADER — white background
    // ================================================
    doc.setFillColor(...headerBg);
    doc.rect(0, 0, pageW, 40, 'F');

    // Elegant divider line at bottom of header (within margins)
    doc.setDrawColor(...lineGray);
    doc.setLineWidth(0.15);
    doc.line(marginL, 40.5, pageW - marginR, 40.5);

    // ── Logo (black PBM anchor on white bg) ──
    try {
        const logoBase64 = await loadImageAsBase64('./logo.png');
        // Maintain a natural portrait aspect ratio for the logo
        doc.addImage(logoBase64, 'PNG', marginL, 6, 26, 34); // Scaled down for elegance
    } catch (e) {
        doc.setFillColor(220, 220, 220);
        doc.roundedRect(marginL, 6, 24, 32, 3, 3, 'F');
        doc.setTextColor(...ink);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('PBM', marginL + 12, 22, { align: 'center' });
    }

    // ── Company Info (Modern Typography) ──
    const compX = marginL + 35;
    const startY = 12;

    // 1. Company Name - Strong & Clear
    doc.setTextColor(35, 35, 35);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('CV. PUTRA BANUA MANDIRI', compX, startY);

    // 2. Tagline - Subdued CAPS
    doc.setTextColor(...accentBar);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.text('GENERAL KONTRAKTOR BARANG DAN JASA', compX, startY + 5.5);

    // 3. Subtle Divider Line
    doc.setDrawColor(...lineGray);
    doc.setLineWidth(0.1);
    doc.line(compX, startY + 7.5, compX + 50, startY + 7.5);

    // 4. Address - Professional Multi-line
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...midGray);
    doc.text('JL. PENASTANI RT.001/RW.001, DS. BAKTI, KEC. BATU BENAWA,', compX, startY + 12);
    doc.text('KAB. HULU SUNGAI TENGAH, KALIMANTAN SELATAN.', compX, startY + 16);

    // 5. Contact Info Block - Modern Horizontal layout
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...ink);
    doc.text('Hubungi:', compX, startY + 24);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...midGray);
    doc.text('0852-4822-2271   |   wawankaluan@gmail.com', compX + 12, startY + 24);

    // ── INVOICE badge (top-right, bordered - ECO) ──
    const badgeW = 40;
    const badgeH = 14;
    const badgeX = pageW - marginR - badgeW;
    const badgeY = 6;

    doc.setDrawColor(...ink);
    doc.setLineWidth(0.4);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'D'); // Outline only
    doc.setFillColor(...lightFill);
    doc.roundedRect(badgeX + 0.5, badgeY + 0.5, badgeW - 1, badgeH - 1, 2, 2, 'F'); // Very light fill

    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('INVOICE', badgeX + (badgeW / 2), badgeY + 9.5, { align: 'center' });

    // ================================================
    // CLIENT & INVOICE INFO SECTION
    // ================================================
    const secY = 44;

    // ── Left: Client info ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...midGray);
    doc.text('KEPADA', marginL, secY + 5);
    doc.setDrawColor(...lineGray);
    doc.setLineWidth(0.2);
    doc.line(marginL, secY + 6.5, marginL + 80, secY + 6.5);

    let cNamePDF = Array.isArray(invoiceData.clientName)
        ? invoiceData.clientName[0]
        : (invoiceData.clientName || '-');

    let cAddrPDF = invoiceData.clientAddress || invoiceData.waNumber || '-';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...darkText);
    // Wrap client name to fit before the right info box (width ~95mm)
    const nameLines = doc.splitTextToSize(cNamePDF, 95);
    doc.text(nameLines, marginL, secY + 13);

    const nameLineH = 5.5; // spacing for wrapped name lines
    const addrStartY = secY + 13 + (nameLines.length * nameLineH) + 1;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...midGray);
    const addrLines = doc.splitTextToSize(cAddrPDF, 85);
    doc.text(addrLines, marginL, addrStartY);

    // Parse items and flags
    let itemsArray = [];
    let flags = { showInv: true, showPo: true, showSite: true, showDate: true };
    let invType = 'normal';
    let rental = { awal: '', akhir: '' };
    let tbArr = [];
    let bgArr = [];
    let descArr = [];

    try {
        const itemObj = typeof invoiceData.items === 'string' ? JSON.parse(invoiceData.items) : invoiceData.items;
        const noteObj = invoiceData.note ? (typeof invoiceData.note === 'string' ? JSON.parse(invoiceData.note) : invoiceData.note) : null;
        // Kolom tb/bg terpisah (format paling baru)
        const tbColRaw = invoiceData.tb ? (typeof invoiceData.tb === 'string' ? JSON.parse(invoiceData.tb) : invoiceData.tb) : null;
        const bgColRaw = invoiceData.bg ? (typeof invoiceData.bg === 'string' ? JSON.parse(invoiceData.bg) : invoiceData.bg) : null;

        if (noteObj) {
            itemsArray = Array.isArray(itemObj) ? itemObj : [];
            flags = noteObj.flags || flags;
            invType = noteObj.type || 'normal';
            rental = noteObj.rental || rental;
            // Prioritas: kolom tb/bg terpisah > note.tb/bg (peralihan) > item.tb/bg (legacy)
            tbArr = Array.isArray(tbColRaw) ? tbColRaw : (noteObj.tb || []);
            bgArr = Array.isArray(bgColRaw) ? bgColRaw : (noteObj.bg || []);
            descArr = noteObj.desc || [];
        } else {
            if (itemObj && itemObj.itemList) {
                itemsArray = itemObj.itemList;
                flags = itemObj.flags || flags;
                invType = itemObj.type || 'normal';
                rental = itemObj.rental || rental;
            } else {
                itemsArray = Array.isArray(itemObj) ? itemObj : [];
            }
        }
    } catch (e) { console.error('Gagal parse items', e); }

    const isRental = invType === 'rental';

    // ── Right: Invoice meta box (Dynamic Rows with Checkbox Triggers) ──
    const showPo = !isRental && (flags.showPo !== false) && !!invoiceData.noPo && invoiceData.noPo.trim().toUpperCase() !== 'NO-ENTRY' && invoiceData.noPo.trim() !== '';
    const showSite = !isRental && (flags.showSite !== false) && !!invoiceData.site && invoiceData.site.trim() !== '';
    const showRental = isRental && rental.awal && rental.akhir;

    const rowH = 12;
    let boxH = rowH; // Always has INV/DATE
    if (showPo) boxH += rowH;
    if (showSite) boxH += rowH;
    if (showRental) boxH += rowH;

    // Calculate how much space the client info on the left takes
    // Name starts at secY + 13, addr starts dynamically after Name
    const addrLineHeight = 4.5;
    const clientInfoH = 13 + (nameLines.length * nameLineH) + (addrLines.length * addrLineHeight);

    const boxX = pageW - marginR - 80;
    const boxY = secY + 1;
    const boxW = 80;

    doc.setFillColor(...boxBg);
    doc.setDrawColor(...lineGray);
    doc.setLineWidth(0.3);
    doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2, 'FD');

    // Middle vertical divider (ONLY for the top row)
    doc.line(boxX + boxW / 2, boxY, boxX + boxW / 2, boxY + rowH);

    // Dynamic Dividers & Content
    let currentY = boxY;

    // --- ROW 1: INV & DATE ---
    const invNum = (flags.showInv !== false) ? (invoiceData.NoInvoice || '').toString() : '';
    const invDate = (flags.showDate !== false && invoiceData.date) ? new Date(invoiceData.date).toLocaleDateString('id-ID') : '';

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...midGray);
    doc.text('NO. INVOICE', boxX + 4, currentY + 4.5);
    doc.text('TANGGAL', boxX + boxW / 2 + 4, currentY + 4.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...ink);
    doc.text(invNum, boxX + 4, currentY + 9.5);
    doc.text(invDate, boxX + boxW / 2 + 4, currentY + 9.5);

    currentY += rowH;

    // --- ROW 2: NO PO (Conditional & Responsive) ---
    if (showPo) {
        doc.setDrawColor(...lineGray);
        doc.line(boxX, currentY, boxX + boxW, currentY);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...midGray);
        doc.text('NO. PO', boxX + 4, currentY + 4.5);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...ink);
        const poLines = doc.splitTextToSize(String(invoiceData.noPo), boxW - 8);
        doc.text(poLines, boxX + 4, currentY + 9.5);
        currentY += (poLines.length > 1 ? rowH + (poLines.length - 1) * 4 : rowH);
    }

    // --- ROW 3: SITE (Conditional & Responsive) ---
    if (showSite) {
        doc.setDrawColor(...lineGray);
        doc.line(boxX, currentY, boxX + boxW, currentY);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...midGray);
        doc.text('SITE', boxX + 4, currentY + 4.5);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...ink);
        const siteLines = doc.splitTextToSize(String(invoiceData.site), boxW - 8);
        doc.text(siteLines, boxX + 4, currentY + 9.5);
        currentY += (siteLines.length > 1 ? rowH + (siteLines.length - 1) * 4 : rowH);
    }

    // --- ROW 4: PERIODE SEWA (Rental only) ---
    if (showRental) {
        doc.setDrawColor(...lineGray);
        doc.line(boxX, currentY, boxX + boxW, currentY);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...midGray);
        doc.text('PERIODE SEWA', boxX + 4, currentY + 4.5);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...ink);
        const awal = new Date(rental.awal).toLocaleDateString('id-ID');
        const akhir = new Date(rental.akhir).toLocaleDateString('id-ID');
        doc.text(`${awal} s/d ${akhir}`, boxX + 4, currentY + 9.5);
    }

    // ================================================
    // ITEMS TABLE
    // ================================================
    // Use the taller of the two sections (Client Info or Meta Box) to start table
    const tableY = secY + Math.max(boxH + 5, clientInfoH + 2);

    const tableBody = itemsArray.map((item, i) => {
        const tbData = tbArr[i] !== undefined ? tbArr[i] : item.tb;
        const bgData = bgArr[i] !== undefined ? bgArr[i] : item.bg;
        const descData = descArr[i] !== undefined ? descArr[i] : item.desc;
        
        return [
            i + 1,
            item.name,
            item.qty,
            'Rp ' + Number(item.price).toLocaleString('id-ID'),
            isRental ? (descData || '-') : ((tbData || "NO-ENTRY") + " / \n" + (bgData || "NO-ENTRY")),
            'Rp ' + (item.qty * item.price).toLocaleString('id-ID')
        ];
    });

    const colName4 = isRental ? 'Keterangan' : 'TB/BG';
    const colAlign4 = isRental ? 'left' : 'center';

    doc.autoTable({
        startY: tableY,
        head: [['#', 'Uraian Pekerjaan / Barang', 'Qty', 'Harga Satuan', colName4, 'Subtotal']],
        body: tableBody,
        theme: 'plain',
        headStyles: {
            fillColor: lightFill,
            textColor: ink,
            fontStyle: 'bold',
            fontSize: 8.5,
            cellPadding: { top: 5, bottom: 5, left: 4, right: 4 }
        },
        bodyStyles: {
            fontSize: 8.5,
            textColor: ink,
            cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
            valign: 'middle' // Ensure all cells are vertically centered
        },
        alternateRowStyles: { fillColor: rowAlt },
        styles: {
            lineWidth: 0,
            overflow: 'linebreak'
        },
        columnStyles: {
            0: { cellWidth: 10, halign: 'center' }, // #
            1: { cellWidth: 'auto' },               // Deskripsi
            2: { cellWidth: 15, halign: 'center' }, // Qty (increased to prevent wrapping)
            3: { cellWidth: 28, halign: 'right' },  // Harga
            4: { cellWidth: 34, halign: colAlign4 },// TB/BG atau Keterangan
            5: { cellWidth: 31, halign: 'right' }   // Subtotal
        }
    });

    const tableEndY = doc.lastAutoTable.finalY;

    // ── Thin line after table ──
    doc.setDrawColor(...lineGray);
    doc.setLineWidth(0.3);
    doc.line(marginL, tableEndY + 1, pageW - marginR, tableEndY + 1);

    // TOTAL PANEL (Eco-friendly Design)
    const totalY = tableEndY + 8;
    const totalBoxX = pageW - marginR - 80;

    doc.setFillColor(...lightFill);
    doc.setDrawColor(...ink);
    doc.setLineWidth(0.5);
    doc.roundedRect(totalBoxX, totalY, 80, 16, 2, 2, 'FD'); // Fill and Draw border

    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('TOTAL TAGIHAN', totalBoxX + 5, totalY + 10);
    doc.setFontSize(12);
    doc.text('Rp ' + Number(invoiceData.totalAmount).toLocaleString('id-ID'),
        totalBoxX + 75, totalY + 10, { align: 'right' });

    // ================================================
    // PAYMENT INFO (bottom-left)
    // ================================================
    const payY = totalY + 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...midGray);
    doc.text('METODE PEMBAYARAN', marginL, payY);

    doc.setDrawColor(...lineGray);
    doc.setLineWidth(0.2);
    doc.line(marginL, payY + 1.5, marginL + 70, payY + 1.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...ink);
    doc.text('Bank MANDIRI', marginL, payY + 7);
    doc.setFont('helvetica', 'bold');
    doc.text('9000018394503', marginL, payY + 13);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...midGray);
    doc.text('a.n. Erwansyah', marginL, payY + 19);

    // ================================================
    // NOTES & SIGNATURES
    // ================================================
    let noteText = '';
    let finalY = payY + 28; 

    try {
        const itemObj = typeof invoiceData.items === 'string' ? JSON.parse(invoiceData.items) : invoiceData.items;
        const noteObj = invoiceData.note ? (typeof invoiceData.note === 'string' ? JSON.parse(invoiceData.note) : invoiceData.note) : null;
        
        if (noteObj) {
            noteText = noteObj.notes || '';
        } else {
            noteText = itemObj?.notes || '';
        }
    } catch (e) { }

    // 1. NOTES
    if (noteText && noteText.trim() !== '') {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...midGray);
        doc.text('CATATAN:', marginL, finalY);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...ink);
        const splitNotes = doc.splitTextToSize(noteText, 180);
        doc.text(splitNotes, marginL, finalY + 5);
        
        // Update finalY for next section
        finalY += 5 + (splitNotes.length * 4.5) + 10; 
    } else {
        // If no notes, signatures start a bit higher or same as where they would be after some minimal gap
        finalY = Math.max(finalY, payY + 28);
    }

    // 2. SIGNATURES (Rental Only)
    if (isRental) {
        // Ensure signatures don't overlap with payment info if notes are empty
        if (!noteText || noteText.trim() === '') {
            finalY = payY + 28; 
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...darkText);
        
        const sigAreaW = 50;
        const sigAreaH = 25;
        
        // Label positions
        doc.text('Pengantar,', marginL + 5, finalY);
        doc.text('Penerima,', pageW - marginR - sigAreaW + 5, finalY);
        
        // Blank space for signature (simulated with a very light underline or just space)
        doc.setDrawColor(...lineGray);
        doc.setLineWidth(0.2);
        
        // Underscore lines for names
        const lineY = finalY + sigAreaH;
        doc.line(marginL, lineY, marginL + sigAreaW, lineY);
        doc.line(pageW - marginR - sigAreaW, lineY, pageW - marginR, lineY);
    }

    // ================================================
    // FOOTER
    // ================================================
    // Elegant divider line at top of footer (within margins)
    doc.setDrawColor(...lineGray);
    doc.setLineWidth(0.15);
    doc.line(marginL, pageH - 12, pageW - marginR, pageH - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...midGray);
    doc.text(
        'Dokumen ini digenerate otomatis oleh sistem CV. Putra Banua Mandiri · Sah tanpa tanda tangan basah',
        pageW / 2, pageH - 7, { align: 'center' }
    );

    // ================================================
    // DOWNLOAD or PREVIEW
    // ================================================
    let safeDate = new Date(invoiceData.date).toLocaleDateString('en-GB').replace(/\//g, '-');
    let safeName = cNamePDF.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/ /g, '_');
    let cleanInv = String(invNum).replace(/[^a-zA-Z0-9\-]/g, '');
    let fileName = `${cleanInv}-${safeName}-${safeDate}.pdf`;

    const pdfBlob = doc.output('blob');

    if (action === 'preview') {
        const blobUrl = URL.createObjectURL(pdfBlob);
        return blobUrl;
    }

    if (action === 'share') {
        return { blob: pdfBlob, title: fileName };
    }

    const blobUrl = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(blobUrl); a.remove(); }, 1500);
};
