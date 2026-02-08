const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';

let masterPages = [];
let splitterPages = []; 
let dragSrcIndex = null;
let selectedOrgIndices = new Set();
let lastSelectedOrgIdx = null;
let wakeLock = null;

const BRAND_NAME = "Carma"; 

// --- THE "STAY AWAKE" ENGINE ---
async function startStayAwake() {
    try {
        // 1. Force the silent audio heartbeat
        const audio = document.getElementById('heartbeat');
        audio.play();
        // 2. Request Screen Wake Lock (prevents CPU throttling)
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
        console.log("Ali's Stay-Awake Engine: ACTIVE");
    } catch (err) { console.log("WakeLock failed, relying on Audio Heartbeat."); }
}

function stopStayAwake() {
    const audio = document.getElementById('heartbeat');
    audio.pause();
    if (wakeLock) {
        wakeLock.release().then(() => wakeLock = null);
    }
    console.log("Ali's Stay-Awake Engine: STANDBY");
}

// --- SHARED UTILS ---
function toggleLoader(show, text, percent = 0) {
    const loader = document.getElementById('loader');
    const label = document.getElementById('loader-text');
    const bar = document.getElementById('progress-bar');
    if (loader) {
        label.innerText = text;
        bar.style.width = percent + "%";
        loader.style.display = show ? 'flex' : 'none';
    }
    if (show) startStayAwake(); else stopStayAwake();
}

async function generateThumb(pdfJsDoc, pageNum) {
    try {
        const page = await pdfJsDoc.getPage(pageNum);
        const vp = page.getViewport({ scale: 0.3 }); 
        const canv = document.createElement('canvas');
        const ctx = canv.getContext('2d', { willReadFrequently: true });
        canv.width = vp.width; canv.height = vp.height;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const data = canv.toDataURL('image/jpeg', 0.5);
        canv.width = 0; canv.height = 0; 
        return data;
    } catch (e) { return ""; }
}

function download(data, name, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
}

// --- NAVIGATION ---
const navButtons = ['organizer', 'splitter', 'converter'];
navButtons.forEach(key => {
    document.getElementById('nav-' + key).addEventListener('click', () => {
        document.querySelectorAll('.tool-section').forEach(s => s.style.display = 'none');
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('tool-' + key).style.display = 'block';
        document.getElementById('nav-' + key).classList.add('active');
    });
});

// --- ORGANIZER ---
const fileOrg = document.getElementById('file-org');
document.getElementById('drop-zone').onclick = () => fileOrg.click();
document.getElementById('add-btn').onclick = () => fileOrg.click();

fileOrg.onchange = async (e) => {
    if (!e.target.files.length) return;
    toggleLoader(true, "Carma: Preparing safe memory...");
    for (let file of e.target.files) {
        const raw = await file.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(raw.slice(0));
        const pdfJsDoc = await pdfjsLib.getDocument({data: raw.slice(0)}).promise;
        const count = pdfDoc.getPageCount();

        for (let i = 0; i < count; i++) {
            const subDoc = await PDFLib.PDFDocument.create();
            const [p] = await subDoc.copyPages(pdfDoc, [i]);
            subDoc.addPage(p);
            masterPages.push({ bytes: await subDoc.save(), thumb: await generateThumb(pdfJsDoc, i + 1) });
            if (i % 5 === 0) toggleLoader(true, `Loading: ${Math.round((i/count)*100)}%`, (i/count)*100);
            await new Promise(r => setTimeout(r, 5));
        }
        await pdfJsDoc.destroy();
    }
    renderGrid();
    toggleLoader(false);
    document.getElementById('drop-zone').style.display = 'none';
};

function renderGrid() {
    const grid = document.getElementById('pages-grid');
    grid.innerHTML = '';
    masterPages.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = `page-card ${selectedOrgIndices.has(index) ? 'selected' : ''}`;
        div.draggable = true;
        div.innerHTML = `<img src="${item.thumb || ''}"><p>Page ${index+1}</p>`;
        div.ondragstart = () => dragSrcIndex = index;
        div.ondragover = (e) => e.preventDefault();
        div.ondrop = () => {
            const movedItem = masterPages.splice(dragSrcIndex, 1)[0];
            masterPages.splice(index, 0, movedItem);
            selectedOrgIndices.clear();
            renderGrid();
        };
        div.onclick = (ev) => {
            if (ev.shiftKey && lastSelectedOrgIdx !== null) {
                const start = Math.min(index, lastSelectedOrgIdx), end = Math.max(index, lastSelectedOrgIdx);
                for (let i = start; i <= end; i++) selectedOrgIndices.add(i);
            } else {
                if (selectedOrgIndices.has(index)) selectedOrgIndices.delete(index);
                else selectedOrgIndices.add(index);
                lastSelectedOrgIdx = index;
            }
            renderGrid();
        };
        const delBtn = document.createElement('div');
        delBtn.className = 'del-btn'; delBtn.innerText = '✕';
        delBtn.onclick = (ev) => { ev.stopPropagation(); masterPages.splice(index, 1); renderGrid(); };
        div.appendChild(delBtn);
        grid.appendChild(div);
    });
}

document.getElementById('select-all-org').onclick = () => { masterPages.forEach((_, i) => selectedOrgIndices.add(i)); renderGrid(); };
document.getElementById('deselect-all-org').onclick = () => { selectedOrgIndices.clear(); renderGrid(); };
document.getElementById('delete-selected-btn').onclick = () => {
    masterPages = masterPages.filter((_, idx) => !selectedOrgIndices.has(idx));
    selectedOrgIndices.clear();
    if (!masterPages.length) location.reload(); else renderGrid();
};
document.getElementById('reverse-btn').onclick = () => { masterPages.reverse(); renderGrid(); };
document.getElementById('save-pdf-btn').onclick = async () => {
    if(!masterPages.length) return;
    toggleLoader(true, "Carma System: Saving PDF...");
    const merged = await PDFLib.PDFDocument.create();
    for (let i = 0; i < masterPages.length; i++) {
        const doc = await PDFLib.PDFDocument.load(masterPages[i].bytes.slice(0));
        const [p] = await merged.copyPages(doc, [0]);
        merged.addPage(p);
        if (i % 10 === 0) toggleLoader(true, `Saving: ${Math.round((i/masterPages.length)*100)}%`, (i/masterPages.length)*100);
    }
    download(await merged.save(), `${BRAND_NAME}_Organized.pdf`, "application/pdf");
    toggleLoader(false);
};

// --- SPLITTER (200MB Background Logic) ---
const fileSplit = document.getElementById('file-split');
const splitGrid = document.getElementById('splitter-grid');
if (document.getElementById('split-upload-zone')) document.getElementById('split-upload-zone').onclick = () => fileSplit.click();

fileSplit.onchange = async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    splitterPages = [];
    toggleLoader(true, "Carma System: Opening Large PDF...");
    const buffer = await file.arrayBuffer();
    const bytes = buffer.slice(0); // Cloned once
    const pdfJsDoc = await pdfjsLib.getDocument({data: bytes.slice(0)}).promise;
    const total = pdfJsDoc.numPages;

    for (let i = 1; i <= total; i++) {
        const thumb = await generateThumb(pdfJsDoc, i);
        splitterPages.push({ bytes: bytes, index: i-1, thumb, selected: true });
        if (i % 5 === 0) {
            toggleLoader(true, `Building Preview: ${Math.round((i/total)*100)}%`, (i/total)*100);
            await new Promise(r => setTimeout(r, 10));
        }
    }
    renderSplitterGrid();
    await pdfJsDoc.destroy();
    toggleLoader(false);
    document.getElementById('split-upload-zone').style.display = 'none';
    document.getElementById('split-all-btn').style.display = 'inline-block';
    document.getElementById('split-none-btn').style.display = 'inline-block';
};

function renderSplitterGrid() {
    splitGrid.innerHTML = '';
    splitterPages.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = `page-card ${item.selected ? 'selected' : ''}`;
        div.innerHTML = `<img src="${item.thumb}"><p>Spread ${index+1}</p>`;
        div.onclick = () => { item.selected = !item.selected; div.classList.toggle('selected'); };
        splitGrid.appendChild(div);
    });
}

document.getElementById('split-all-btn').onclick = () => { splitterPages.forEach(p => p.selected = true); renderSplitterGrid(); };
document.getElementById('split-none-btn').onclick = () => { splitterPages.forEach(p => p.selected = false); renderSplitterGrid(); };

document.getElementById('split-selected-btn').onclick = async () => {
    if (!splitterPages.length) return;
    toggleLoader(true, "Carma System: Splitting Spread Pages...");
    try {
        const dir = document.getElementById('split-direction').value;
        const outDoc = await PDFLib.PDFDocument.create();
        const srcDoc = await PDFLib.PDFDocument.load(splitterPages[0].bytes.slice(0));
        const srcPages = srcDoc.getPages();

        for (let i = 0; i < splitterPages.length; i++) {
            const item = splitterPages[i];
            if (!item.selected) {
                const [copied] = await outDoc.copyPages(srcDoc, [item.index]);
                outDoc.addPage(copied);
            } else {
                const [embedded] = await outDoc.embedPages([srcPages[item.index]]);
                const { width, height } = srcPages[item.index].getSize();
                const half = width / 2;
                const p1 = outDoc.addPage([half, height]), p2 = outDoc.addPage([half, height]);
                if (dir === 'ltr') {
                    p1.drawPage(embedded, { x: 0, y: 0, width, height, clipX: 0, clipY: 0, clipWidth: half, clipHeight: height });
                    p2.drawPage(embedded, { x: -half, y: 0, width, height, clipX: half, clipY: 0, clipWidth: half, clipHeight: height });
                } else {
                    p1.drawPage(embedded, { x: -half, y: 0, width, height, clipX: half, clipY: 0, clipWidth: half, clipHeight: height });
                    p2.drawPage(embedded, { x: 0, y: 0, width, height, clipX: 0, clipY: 0, clipWidth: half, clipHeight: height });
                }
            }
            if (i % 5 === 0) toggleLoader(true, `Splitting: ${Math.round((i/splitterPages.length)*100)}%`, (i/splitterPages.length)*100);
            await new Promise(r => setTimeout(r, 10));
        }
        download(await outDoc.save(), `${BRAND_NAME}_Split_Result.pdf`, "application/pdf");
    } catch (e) { alert("Split failed: " + e.message); }
    toggleLoader(false);
};

// --- CONVERTER ---
document.getElementById('conv-upload-zone').onclick = () => document.getElementById('file-conv').click();
document.getElementById('file-conv').onchange = async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const name = file.name.replace(/\.[^/.]+$/, "");
    toggleLoader(true, "Carma System: Batch Exporting...");
    const zip = new JSZip(), folder = zip.folder(name);
    const pdfJsDoc = await pdfjsLib.getDocument({data: await file.arrayBuffer()}).promise;
    const total = pdfJsDoc.numPages;
    const batchSize = 2; 

    for (let i = 1; i <= total; i += batchSize) {
        const batch = [];
        for (let j = i; j < i + batchSize && j <= total; j++) {
            batch.push((async (pNum) => {
                const page = await pdfJsDoc.getPage(pNum);
                const vp = page.getViewport({ scale: 2.0 }); 
                const canv = document.createElement('canvas');
                const ctx = canv.getContext('2d', { willReadFrequently: true });
                canv.width = vp.width; canv.height = vp.height;
                await page.render({ canvasContext: ctx, viewport: vp }).promise;
                const blob = await new Promise(res => canv.toBlob(res, 'image/jpeg', 0.8));
                folder.file(`${name}_Page_${pNum}.jpg`, blob);
                canv.width = 0; canv.height = 0; 
            })(j));
        }
        await Promise.all(batch);
        toggleLoader(true, `Exporting: ${Math.round((i/total)*100)}%`, (i/total)*100);
        await new Promise(r => setTimeout(r, 20)); 
    }
    const zipBlob = await zip.generateAsync({type:"blob"});
    download(zipBlob, `${BRAND_NAME}_${name}.zip`, "application/zip");
    await pdfJsDoc.destroy();
    toggleLoader(false);
};