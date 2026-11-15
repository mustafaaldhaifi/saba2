import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from '../../config/firebase';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { reportBranchesForCity } from './reportBranches';
import { daysForReportPeriod, totalsForReportPeriod } from './reportPeriod';

/**
 * Builds a monthly or single-day report across selected branches.
 * 1. Start with branches in the chosen city scope and period.
 * 2. Load product identities and selected summary days for those branches.
 * 3. Present branch choices and export results in their supplied order.
 */
const GlobalMonthlyReport = ({ branches, typeId, initialMonth, onClose, cityName, products: currentProducts }) => {
    // STEP 1: The parent supplies Riyadh-first branches; select the requested city initially.
    const [selectedMonth, setSelectedMonth] = useState(initialMonth || new Date().toISOString().substring(0, 7));
    const [selectedDay, setSelectedDay] = useState('');
    const [selectedBranches, setSelectedBranches] = useState(() =>
        reportBranchesForCity(branches, cityName || 'all').map(branch => branch.id));
    const [selectedFields, setSelectedFields] = useState(['sales']);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: branches.length, branchName: '' });
    const [completed, setCompleted] = useState(false);
    const [processedSelectionKey, setProcessedSelectionKey] = useState('');
    const [allProducts, setAllProducts] = useState([]);
    const [aggregatedData, setAggregatedData] = useState({}); // { linkId: { branchId: { field: value } } }
    const [cityFilter, setCityFilter] = useState(cityName || 'all');
    const selectionKey = JSON.stringify([selectedMonth, selectedDay, selectedBranches, selectedFields]);
    const canExport = completed && processedSelectionKey === selectionKey;
    const reportPeriod = selectedDay || selectedMonth;

    const fieldOptions = [
         { value: 'openingStock', label: 'الرصيد الموجود' },
        { value: 'received', label: 'المستلم' },
        { value: 'add', label: 'الجرد' },
        { value: 'sales', label: 'مبيعات' },
        { value: 'staffMeal', label: 'وجبة موظف' },
        { value: 'damaged', label: 'التالف' },
        { value: 'canceled', label: 'الملغي' },
       
        { value: 'transfer', label: 'تحويل' },
        { value: 'directTransfer', label: 'تجهيز مباشر' },
        { value: 'freeIncrease', label: 'تعويض زبون' },
        { value: 'closeStock', label: 'المتبقي' },
    ];

    // STEP 2: Fetch all product identities so both city groups can be combined.
    useEffect(() => {
        const fetchAllProducts = async () => {
            if (!typeId) return;
            try {
                // Fetch products for both cities to have full mapping
                const q = query(collection(db, "products"), where("typeId", "==", typeId));
                const snap = await getDocs(q);
                const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                setAllProducts(items);
            } catch (error) {
                console.error("Error fetching all products:", error);
            }
        };
        fetchAllProducts();
    }, [typeId]);

    /**
     * Aggregates the chosen period across the selected branches.
     * 1. Validate the period and selected report inputs.
     * 2. Load monthly summaries and keep only the requested days.
     * 3. Publish totals only when the period has data.
     */
    const handleStartProcessing = async () => {
        // STEP 1: A selected day must belong to the shown month.
        if (!selectedMonth || selectedBranches.length === 0 || selectedFields.length === 0) {
            alert("يرجى اختيار شهر واحد وفرع واحد ونوع بيانات واحد على الأقل");
            return;
        }
        if (selectedDay && selectedDay.slice(0, 7) !== selectedMonth) {
            alert('تاريخ التقرير يجب أن يكون ضمن الشهر المحدد.');
            return;
        }
        setIsProcessing(true);
        setCompleted(false);
        const results = {}; // Map to store grouped results

        const targetBranches = branches.filter(b => selectedBranches.includes(b.id));

        try {
            // STEP 2: Product identities and monthly summaries cover both city groups.
            const productLookup = allProducts.length ? allProducts :
                (await getDocs(query(collection(db, 'products'), where('typeId', '==', typeId))))
                    .docs.map(product => ({ id: product.id, ...product.data() }));
            for (let i = 0; i < targetBranches.length; i++) {
                const branch = targetBranches[i];
                setProgress({ current: i + 1, total: targetBranches.length, branchName: branch.name });

                // Read the month containing the requested report day.
                const q = query(
                    collection(db, "product_monthly_summaries"),
                    where("branchId", "==", branch.id),
                    where("month", "==", selectedMonth)
                );

                const snap = await getDocs(q);

                snap.docs.forEach(doc => {
                    const data = doc.data();
                    const productId = data.productId;
                    if (!productId) return;

                    const dayValuesMap = daysForReportPeriod(data, selectedDay);
                    const totals = totalsForReportPeriod(dayValuesMap, selectedFields);
                    if (selectedDay && !totals) return;

                    // Find product linkId or use productId as fallback
                    const prodInfo = productLookup.find(p => p.id === productId) || currentProducts.find(p => p.id === productId);
                    const linkId = prodInfo?.linkId || productId;
                    const prodName = prodInfo?.name || "منتج غير معروف";

                    if (!results[linkId]) {
                        results[linkId] = {
                            name: prodName,
                            parentProduct: prodInfo?.parentProduct,
                            isSales: prodInfo?.isSales,
                            branches: {}
                        };
                    }
                    if (!results[linkId].branches[branch.id]) {
                        results[linkId].branches[branch.id] = {};
                    }

                    // Stock balances use the period endpoints; flow fields use its included days.
                    if (totals) {
                        results[linkId].branches[branch.id].openingStock_pure = totals.openingStock_pure;
                        results[linkId].branches[branch.id].remaining_pure = totals.remaining_pure;
                    }
                    selectedFields.forEach(field => {
                        results[linkId].branches[branch.id][field] =
                            (results[linkId].branches[branch.id][field] || 0) + (totals?.fieldTotals[field] || 0);
                    });
                });
            }

            // STEP 3: Empty days must not produce an export with misleading zeros.
            if (!Object.keys(results).length) {
                alert(selectedDay ? 'لا توجد بيانات جرد في التاريخ المحدد للفروع المختارة.' :
                    'لا توجد بيانات جرد في الشهر المحدد للفروع المختارة.');
                return;
            }
            setAggregatedData(results);
            setProcessedSelectionKey(selectionKey);
            setCompleted(true);
        } catch (error) {
            console.error("Processing error:", error);
            alert("حدث خطأ أثناء معالجة البيانات");
        } finally {
            setIsProcessing(false);
        }
    };


    /**
     * Exports the processed day or month as one combined workbook.
     * 1. Refuse totals from a different selection.
     * 2. Build branch columns and field sections in display order.
     * 3. Save a file named for the processed period.
     */
    const handleExport = async () => {
    // STEP 1: Filter changes require a fresh processing run.
    
    if (!canExport || Object.keys(aggregatedData).length === 0 || selectedBranches.length === 0 || selectedFields.length === 0) return;

    // STEP 2: Branch order is preserved in the combined sheet.
    const targetBranches = branches.filter(b => selectedBranches.includes(b.id));
    const workbook = new ExcelJS.Workbook();
    
    // إنشاء ورقة عمل مجمعة
    const worksheet = workbook.addWorksheet("البيانات الشاملة");
    worksheet.views = [{ showGridLines: true }]; // إظهار خطوط الشبكة الافتراضية

    let combinedData = [];
    let headerPositions = [];
    let currentLine = 1;

    selectedFields.forEach(field => {
        const fieldLabel = fieldOptions.find(f => f.value === field)?.label || field;

        // 1. إعداد الترويسة وعناوين الفروع
        const header = ["المنتج", ...targetBranches.map(b => b.name), "الإجمالي العام"];
        const titleRowData = [`--- تقرير الفروع - ${reportPeriod} - ${fieldLabel} ---`];

        // 2. جلب كافة صفوف البيانات وترتيبها تلقائياً بدون أي فلترة للمنتجات
        const sortedLinkIds = Object.keys(aggregatedData).sort((a, b) =>
            aggregatedData[a].name.localeCompare(aggregatedData[b].name)
        );

        let fieldRows = [];

        sortedLinkIds.forEach(linkId => {
            const prod = aggregatedData[linkId];

            // شروط المبيعات السابقة الخاصة بك (تُترك كما هي)
            const isSalesItem = prod.isSales === true || prod.isSales === "true";
            if (field !== 'sales' && isSalesItem) return;

            const row = [prod.name];
            let rowTotal = 0;

            targetBranches.forEach(branch => {
                const val = prod.branches[branch.id]?.[field] || 0;
                row.push(val);
                rowTotal += val;
            });

            row.push(rowTotal);
            fieldRows.push(row);
        });

        // إذا وُجدت بيانات لهذا الحقل، نجهز مواقع التنسيق والدمج
        if (fieldRows.length > 0) {
            headerPositions.push({
                titleRow: currentLine,
                subHeaderRow: currentLine + 1
            });

            combinedData = [...combinedData, titleRowData, header, ...fieldRows, []];
            currentLine += fieldRows.length + 3; // ضبط المؤشر للجدول التالي
        }
    });

    if (combinedData.length === 0) return;

    // إضافة البيانات بالكامل إلى الورقة
    worksheet.addRows(combinedData);

    // حساب أقصى عمود ممتلئ ديناميكياً
    let maxColumnKey = 1;
    worksheet.eachRow((row) => {
        if (row.cellCount > maxColumnKey) maxColumnKey = row.cellCount;
    });
    const lastColumnLetter = worksheet.getColumn(maxColumnKey).letter;

    // --- 1. تنسيق ودمج الترويسات الخضراء بالكامل لكل حقل ---
    headerPositions.forEach(pos => {
        try { worksheet.mergeCells(`A${pos.titleRow}:${lastColumnLetter}${pos.titleRow}`); } catch (e) {}
        
        const titleCell = worksheet.getCell(`A${pos.titleRow}`);
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } }; // أخضر غامق
        titleCell.font = { name: 'Segoe UI', color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getRow(pos.titleRow).height = 25;

        const subHeaderRow = worksheet.getRow(pos.subHeaderRow);
        subHeaderRow.eachCell({ includeEmpty: true }, (cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } };
            cell.font = { name: 'Segoe UI', color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
    });

    let dataRowIndex = 0;

    // --- 2. تنسيق البيانات والتناوب اللوني الغامق والأبيض والسالب ---
    worksheet.eachRow((row, rowNumber) => {
        const isHeader = headerPositions.some(pos => rowNumber === pos.titleRow || rowNumber === pos.subHeaderRow);
        const isEmptyRow = row.values.every(v => v === null || v === undefined || v === '');

        if (!isHeader && !isEmptyRow) {
            dataRowIndex++;
            // التناوب اللوني الرمادي الأغمق بناءً على طلبك
            const rowBgColor = dataRowIndex % 2 === 0 ? 'FFF2F2F2' : 'FFFFFFFF';

            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                // الحدود والمحاذاة للوسط
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FF000000' } },
                    left: { style: 'thin', color: { argb: 'FF000000' } },
                    bottom: { style: 'thin', color: { argb: 'FF000000' } },
                    right: { style: 'thin', color: { argb: 'FF000000' } }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };

                // تلوين الخلفية التناوبية للصف (باستثناء الإجمالي العام)
                if (colNumber !== maxColumnKey) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBgColor } };
                    cell.font = { name: 'Segoe UI', color: { argb: 'FF000000' } };
                }

                // معالجة الأرقام والأصناف والسوالب والأصناف الصفرية
                if (typeof cell.value === 'number') {
                    if (cell.value === 0) {
                        cell.value = ''; // إخفاء الأصفار لتظهر الخلايا فارغة تماماً
                    } else if (cell.value < 0) {
                        // تلوين كامل الخلايا السالبة باللون الأحمر والنص بالأبيض
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
                        cell.font = { name: 'Segoe UI', color: { argb: 'FFFFFFFF' }, bold: true };
                        cell.numFmt = '#,##0;[White]-#,##0;""';
                    } else {
                        cell.numFmt = '#,##0;;""'; // الموجب عادي مع فواصل آلاف
                    }
                }
            });

            // تلوين عمود الإجمالي العام في نهاية كل صف بالأخضر الفاتح المخصص للنتائج
            const totalCell = row.getCell(maxColumnKey);
            if (totalCell && totalCell.value !== '') {
                if (typeof totalCell.value === 'number' && totalCell.value < 0) {
                    totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
                    totalCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
                } else {
                    totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
                    totalCell.font = { color: { argb: 'FF006100' }, bold: true };
                }
            }
        }
    });

    // --- 3. ضبط ذكي وملموم لعرض الأعمدة بدون مساحات ضائعة ---
    worksheet.columns.forEach((column, colIndex) => {
        if (colIndex === 0) {
            // العمود الأول: اسم المنتج (يأخذ مقاس أطول اسم بالضبط دون التأثر بالعناوين الكبيرة)
            let maxLen = 12;
            column.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
                const isHeader = headerPositions.some(pos => rowNumber === pos.titleRow || rowNumber === pos.subHeaderRow);
                if (!isHeader && cell.value) {
                    const len = cell.value.toString().length;
                    if (len > maxLen) maxLen = len;
                }
            });
            column.width = maxLen + 3;
        } else if (column.letter === lastColumnLetter) {
            column.width = 12; // عمود الإجمالي العام النهائي
        } else {
            // أعمدة الفروع: تكون ملمومة وصغيرة ومناسبة للأرقام تماماً
            column.width = 10;
        }
    });

    // إعداد اسم الملف النهائي والتحميل المباشر
    let fieldsName = selectedFields.length === 1 ? `_${fieldOptions.find(f => f.value === selectedFields[0])?.label}` : `_بيانات_متعددة`;
    // STEP 3: The filename identifies the exact day when one was selected.
    const fileName = `Global_Report${fieldsName}_${reportPeriod}.xlsx`;

    try {
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, fileName);
    } catch (error) {
        console.error("خطأ أثناء تصدير ملف إكسيل الشامل:", error);
    }
};
/**
 * Exports one worksheet per branch for the processed period.
 * 1. Refuse totals from a different selection.
 * 2. Build each branch worksheet with its chosen fields.
 * 3. Save a file named for the processed day or month.
 */
const handleExport2 = async () => {
    // STEP 1: Filter changes require a fresh processing run.
    if (!canExport || Object.keys(aggregatedData).length === 0 || selectedBranches.length === 0 || selectedFields.length === 0) return;

    // STEP 2: The supplied branch order also controls worksheet order.
    const targetBranches = branches.filter(b => selectedBranches.includes(b.id));
    const workbook = new ExcelJS.Workbook();

    targetBranches.forEach(branch => {
        let sheetName = branch.name.substring(0, 31);
        const worksheet = workbook.addWorksheet(sheetName);
        worksheet.views = [{ showGridLines: true }]; // إظهار خطوط الشبكة

        let combinedData = [];
        
        // بناء الترويسة العلوية بدون حقل "الإجمالي العام"
        const fieldLabels = selectedFields.map(f => fieldOptions.find(opt => opt.value === f)?.label || f);
        const header = ["المنتج", ...fieldLabels]; // ❌ تم إزالة "الإجمالي العام" من هنا
        
        const titleRowData = [`--- تقرير فرع: ${branch.name} - ${selectedDay ? 'ليوم' : 'لشهر'}: ${reportPeriod} ---`];
        combinedData.push(titleRowData);
        combinedData.push(header);

        // ترتيب المنتجات أبجدياً
        const sortedLinkIds = Object.keys(aggregatedData).sort((a, b) =>
            aggregatedData[a].name.localeCompare(aggregatedData[b].name)
        );

        let fieldRows = [];

        sortedLinkIds.forEach(linkId => {
            const prod = aggregatedData[linkId];
            const prodBranchData = prod.branches[branch.id];

            if (!prodBranchData) return;

            const row = [prod.name];

            // نمر على الحقول المحددة لتصبح هي الأعمدة الأفقية للجدول
            selectedFields.forEach((field) => {
                let val = 0;

                // 🛑 1. إذا كان الحقل هو الموجودة (الافتتاحي) خذ القيمة الأولى النظيفة
                if (field === 'existing' || field === 'الموجودة' || field === 'openingStock') {
                    val = prodBranchData.openingStock_pure !== undefined ? prodBranchData.openingStock_pure : (prodBranchData[field] || 0);
                } 
                // 🛑 2. إذا كان الحقل هو المتبقي (الختامي) خذ القيمة الأخيرة النظيفة
                else if (field === 'remaining' || field === 'المتبقي' || field === 'closeStock') {
                    val = prodBranchData.remaining_pure !== undefined ? prodBranchData.remaining_pure : (prodBranchData[field] || 0);
                } 
                // Other fields contain totals for the chosen day or month.
                else {
                    val = prodBranchData[field] || 0;
                }

                // شرط المبيعات الخاص بك للأصناف غير المخصصة للبيع
                const isSalesItem = prod.isSales === true || prod.isSales === "true";
                if (field !== 'sales' && isSalesItem) {
                    val = 0; 
                }

                row.push(val); // ❌ تم إزالة حساب rowTotal وجمعه أفقياً
            });

            fieldRows.push(row);
        });

        if (fieldRows.length === 0) return;

        // ❌ تم إزالة بناء وحقن صف "الإجمالي" السفلي (totalRowData) من هنا تماماً
        combinedData = [...combinedData, ...fieldRows];
        worksheet.addRows(combinedData);

        // ==================== التنسيقات البصرية (Design & Styling) ====================
        const lastColumnLetter = worksheet.getColumn(header.length).letter;

        // أ) دمج وتنسيق العنوان الرئيسي للفرع
        try { worksheet.mergeCells(`A1:${lastColumnLetter}1`); } catch (e) {}
        const titleCell = worksheet.getCell('A1');
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } };
        titleCell.font = { name: 'Segoe UI', color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getRow(1).height = 25;

        // ب) تنسيق ترويسة الأعمدة (الحقول المختارة)
        const subHeaderRow = worksheet.getRow(2);
        subHeaderRow.eachCell({ includeEmpty: true }, (cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } };
            cell.font = { name: 'Segoe UI', color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });

        // ج) تنسيق صفوف البيانات والتناوب اللوني (Zebra Rows) والأسعار والسوالب واختفاء الأصفار
        let dataRowIndex = 0;
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber <= 2) return; // تخطي العناوين

            dataRowIndex++;
            const rowBgColor = dataRowIndex % 2 === 0 ? 'FFF2F2F2' : 'FFFFFFFF';

            row.eachCell({ includeEmpty: true }, (cell) => {
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FF000000' } },
                    left: { style: 'thin', color: { argb: 'FF000000' } },
                    bottom: { style: 'thin', color: { argb: 'FF000000' } },
                    right: { style: 'thin', color: { argb: 'FF000000' } }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };

                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBgColor } };
                cell.font = { name: 'Segoe UI', color: { argb: 'FF000000' } };

                if (typeof cell.value === 'number') {
                    if (cell.value === 0) {
                        cell.value = ''; // إخفاء الأصفار لجعل الملف مريحاً للعين
                    } else if (cell.value < 0) {
                        // تلوين القيم السالبة باللون الأحمر تلقائياً لتنبيه الإدارة
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
                        cell.font = { name: 'Segoe UI', color: { argb: 'FFFFFFFF' }, bold: true };
                        cell.numFmt = '#,##0;[White]-#,##0;""';
                    } else {
                        cell.numFmt = '#,##0;;""';
                    }
                }
            });
        });

        // هـ) ضبط عرض الأعمدة بشكل تلقائي ومحكم ليتناسب مع أطوال أسماء المنتجات
        worksheet.columns.forEach((column, colIndex) => {
            if (colIndex === 0) {
                let maxLen = 12;
                column.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
                    if (rowNumber > 2 && cell.value) {
                        const len = cell.value.toString().length;
                        if (len > maxLen) maxLen = len;
                    }
                });
                column.width = maxLen + 3; // عرض عمود المنتج
            } else {
                column.width = 12; // عرض أعمدة الحقول الأخرى
            }
        });
    });

    if (workbook.worksheets.length === 0) return;

    let fieldsName = selectedFields.length === 1 ? `_${fieldOptions.find(f => f.value === selectedFields[0])?.label}` : `_حقول_متعددة`;
    // STEP 3: The filename identifies the exact day when one was selected.
    const fileName = `تقرير_جرد_الفروع${fieldsName}_${reportPeriod}.xlsx`;

    try {
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, fileName);
    } catch (error) {
        console.error("خطأ أثناء استخراج وتصدير ملف الإكسيل المطور:", error);
    }
};
    // const handleExport = () => {
    //     if (Object.keys(aggregatedData).length === 0) return;

    //     const targetBranches = branches.filter(b => selectedBranches.includes(b.id));
    //     const wb = XLSX.utils.book_new();
    //     let combinedData = [];

    //     selectedFields.forEach(field => {
    //         const fieldLabel = fieldOptions.find(f => f.value === field)?.label || field;

    //         // 1. Header Row
    //         const header = ["المنتج", ...targetBranches.map(b => b.name), "الإجمالي العام"];
    //         combinedData.push([`--- تقرير الفروع - ${selectedMonth} - ${fieldLabel} ---`]);
    //         combinedData.push(header);

    //         // 2. Data Rows
    //         const sortedLinkIds = Object.keys(aggregatedData).sort((a, b) =>
    //             aggregatedData[a].name.localeCompare(aggregatedData[b].name)
    //         );

    //         sortedLinkIds.forEach(linkId => {
    //             const prod = aggregatedData[linkId];

    //             const isSalesItem = prod.isSales === true || prod.isSales === "true";
    //             if (field !== 'sales' && isSalesItem) return;

    //             const row = [prod.name];
    //             let rowTotal = 0;

    //             targetBranches.forEach(branch => {
    //                 const val = prod.branches[branch.id]?.[field] || 0;
    //                 row.push(val);
    //                 rowTotal += val;
    //             });

    //             row.push(rowTotal);
    //             combinedData.push(row);
    //         });

    //         combinedData.push([]); // Empty row for spacing
    //     });

    //     const ws = XLSX.utils.aoa_to_sheet(combinedData);
    //     XLSX.utils.book_append_sheet(wb, ws, "البيانات الشاملة");

    //     let fieldsName = selectedFields.length === 1 ? `_${fieldOptions.find(f => f.value === selectedFields[0])?.label}` : `_بيانات_متعددة`;
    //     XLSX.writeFile(wb, `Global_Report${fieldsName}_${selectedMonth}.xlsx`);
    // };

    return (
        <div className="card" style={{
            marginTop: '1rem',
            padding: '2rem',
            border: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
            <div style={{ marginBottom: '2rem', borderBottom: '2px solid #f1f5f9', paddingBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ margin: 0, color: 'hsl(var(--color-primary))', fontSize: '1.5rem' }}>{selectedDay ? 'التقرير اليومي الشامل لكافة الفروع' : 'التقرير الشهري الشامل لكافة الفروع'}</h2>
                    <p style={{ margin: '5px 0 0', color: '#64748b' }}>عرض وتصدير إحصائيات المنتجات عبر الفروع المختارة</p>
                </div>
                <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.5rem', color: '#94a3b8' }}>&times;</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#475569' }}>الشهر</label>
                    <input
                        type="month"
                        className="input-field"
                        value={selectedMonth}
                        onChange={(e) => {
                            setSelectedMonth(e.target.value);
                            setSelectedDay('');
                        }}
                        disabled={isProcessing}
                        style={{ padding: '0.75rem', borderRadius: '8px' }}
                    />
                </div>

                <div className="input-group" style={{ marginBottom: 0 }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#475569' }}>تاريخ التقرير (اختياري)</label>
                    <input
                        type="date"
                        className="input-field"
                        value={selectedDay}
                        onChange={(e) => {
                            const day = e.target.value;
                            setSelectedDay(day);
                            if (day) setSelectedMonth(day.slice(0, 7));
                        }}
                        disabled={isProcessing}
                        style={{ padding: '0.75rem', borderRadius: '8px' }}
                    />
                    <small style={{ color: '#64748b' }}>اتركه فارغًا لتقرير الشهر كاملًا</small>
                </div>

                <div className="input-group" style={{ marginBottom: 0 }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#475569' }}>تحديد الفروع</label>
                    <select
                        value={cityFilter}
                        onChange={(e) => setCityFilter(e.target.value)}
                        style={{ marginBottom: '8px', width: '100%', padding: '4px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    >
                        <option value="all">كل المدن</option>
                        <option value="ryad">الرياض</option>
                        <option value="other">خارج الرياض</option>
                    </select>
                    <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.5rem', backgroundColor: '#fff' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderBottom: '1px solid #f1f5f9', fontWeight: 'bold' }}>
                            <input
                                type="checkbox"
                                checked={branches.length > 0 && branches.every(b => selectedBranches.includes(b.id))}
                                onChange={(e) => {
                                    if (e.target.checked) {
                                        setSelectedBranches(branches.map(b => b.id));
                                    } else {
                                        setSelectedBranches([]);
                                    }
                                }}
                                disabled={isProcessing}
                            />
                            تحديد الكل (كافة المدن)
                        </label>
                        {reportBranchesForCity(branches, cityFilter).map(b => (
                                <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '0.85rem' }}>
                                    <input
                                        type="checkbox"
                                        checked={selectedBranches.includes(b.id)}
                                        onChange={(e) => {
                                            if (e.target.checked) setSelectedBranches([...selectedBranches, b.id]);
                                            else setSelectedBranches(selectedBranches.filter(id => id !== b.id));
                                        }}
                                        disabled={isProcessing}
                                    />
                                    {b.name} <small style={{ color: '#94a3b8' }}>({b.city === 'other' ? 'خارج الرياض' : 'الرياض'})</small>
                                </label>
                            ))}
                    </div>
                </div>

                <div className="input-group" style={{ marginBottom: 0 }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#475569' }}>نوع البيانات</label>
                    <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.5rem', backgroundColor: '#fff' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderBottom: '1px solid #f1f5f9', fontWeight: 'bold' }}>
                            <input
                                type="checkbox"
                                checked={selectedFields.length === fieldOptions.length}
                                onChange={(e) => setSelectedFields(e.target.checked ? fieldOptions.map(f => f.value) : [])}
                                disabled={isProcessing}
                            />
                            تحديد الكل
                        </label>
                        {fieldOptions.map(f => (
                            <label key={f.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '0.85rem' }}>
                                <input
                                    type="checkbox"
                                    checked={selectedFields.includes(f.value)}
                                    onChange={(e) => {
                                        if (e.target.checked) setSelectedFields([...selectedFields, f.value]);
                                        else setSelectedFields(selectedFields.filter(v => v !== f.value));
                                    }}
                                    disabled={isProcessing}
                                />
                                {f.label}
                            </label>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                   
                    <button
                        onClick={handleStartProcessing}
                        className="btn"
                        disabled={isProcessing}
                        style={{
                            width: '100%',
                            backgroundColor: 'hsl(var(--color-primary))',
                            color: 'white',
                            padding: '0.75rem',
                            fontWeight: '600',
                            opacity: isProcessing ? 0.7 : 1
                        }}
                    >
                        {isProcessing ? 'جاري المعالجة...' : 'ابدأ معالجة البيانات'}
                    </button>
                </div>
            </div>

            {isProcessing && (
                <div style={{ padding: '2rem', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span style={{ fontWeight: '600', color: '#475569' }}>
                            جاري جلب بيانات: <span style={{ color: 'hsl(var(--color-primary))' }}>{progress.branchName}</span>
                        </span>
                        <span style={{ color: '#64748b' }}>{progress.current} / {progress.total}</span>
                    </div>
                    <div style={{ width: '100%', height: '12px', backgroundColor: '#e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                        <div style={{
                            width: `${(progress.current / progress.total) * 100}%`,
                            height: '100%',
                            backgroundColor: 'hsl(var(--color-primary))',
                            transition: 'width 0.3s ease'
                        }}></div>
                    </div>
                </div>
            )}

            {canExport && (
                <div style={{ textAlign: 'center', padding: '2rem', backgroundColor: '#ecfdf5', borderRadius: '12px', border: '1px solid #a7f3d0' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
                    <h3 style={{ color: '#065f46', margin: '0 0 0.5rem 0' }}>اكتملت معالجة البيانات بنجاح!</h3>
                    <p style={{ color: '#047857', marginBottom: '1.5rem' }}>تم تجميع بيانات {selectedDay ? `يوم ${selectedDay}` : `شهر ${selectedMonth}`} لعدد {selectedBranches.length} فرع ولعدد {selectedFields.length} نوع(أنواع) بيانات.</p>
                    <button
                        onClick={handleExport}
                        className="btn"
                        style={{ backgroundColor: '#10b981', color: 'white', padding: '1rem 2.5rem', fontSize: '1.1rem', fontWeight: '700' }}
                    >
                        📊 تحميل ملف Excel الشامل
                    </button>

                     <button
                        onClick={handleExport2}
                        className="btn"
                        style={{ backgroundColor: '#10b981', color: 'white', padding: '1rem 2.5rem', fontSize: '1.1rem', fontWeight: '700' }}
                    >
                        📊 تحميل ملف Excel ملخص
                    </button>
                </div>
            )}
        </div>
    );
};

export default GlobalMonthlyReport;
