import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, writeBatch, Timestamp, serverTimestamp, setDoc, orderBy } from "firebase/firestore";
import { db } from '../../config/firebase';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const MonthlyBranchReport = ({ branchId, branches, city, typeId, products, onClose, branchName, onOpenCorrection }) => {
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7)); // YYYY-MM
    const [selectedBranches, setSelectedBranches] = useState([branchId]);
    const [selectedFields, setSelectedFields] = useState([]);
        const [selectedproducts, setSelectedProducts] = useState([]);
    const [monthlyData, setMonthlyData] = useState([]);
    const [initialMonthlyData, setInitialMonthlyData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [dataFetched, setDataFetched] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    const fieldOptions = [
        { value: 'received', label: 'مستلم' },
        { value: 'add', label: 'إضافة' },
          { value: 'staffMeal', label: 'وجبة موظف' },
          { value: 'damaged', label: 'تالف' },
              { value: 'transfer', label: 'تحويل' },
               { value: 'freeIncrease', label: 'زيادة مجانية' },
                  { value: 'canceled', label: 'مكنسل' },
        { value: 'sales', label: 'مبيعات' },
      
        
          { value: 'directTransfer', label: 'تحويل مباشر' },  
        { value: 'openingStock', label: 'المخزون الإفتتاحي' },
    
   
        { value: 'closeStock', label: 'المتبقي' }
    ];

    useEffect(() => {
        setDataFetched(false);
        setMonthlyData([]);
        setInitialMonthlyData([]);
        setHasUnsavedChanges(false);
    }, [selectedBranches, selectedMonth]);

    const handleFetchData = async () => {
        if (selectedBranches.length === 0 || !selectedMonth) {
            alert("يرجى تحديد الفروع والشهر أولاً");
            return;
        }
        setLoading(true);
        try {
            let allData = [];
            for (let bId of selectedBranches) {
                const q = query(
                    collection(db, "product_monthly_summaries"),
                    where("branchId", "==", bId),
                    where("month", "==", selectedMonth)
                );
                const snapshot = await getDocs(q);
                allData = [...allData, ...snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))];
            }
            setMonthlyData(JSON.parse(JSON.stringify(allData)));
            setInitialMonthlyData(JSON.parse(JSON.stringify(allData)));
            setDataFetched(true);
            setHasUnsavedChanges(false);
        } catch (error) {
            console.error("Error fetching monthly data:", error);
            alert("حدث خطأ أثناء جلب البيانات.");
        } finally {
            setLoading(false);
        }
    };

    const [year, month] = selectedMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const reportMap = {};
    const activeFieldForUI = (selectedFields.length === 1 && selectedBranches.length === 1) ? selectedFields[0] : null;

    // Handlers removed to standalone component

    if (activeFieldForUI) {
        monthlyData.forEach(prodDoc => {
            const productId = prodDoc.productId;
            if (!productId) return;
            if (!reportMap[productId]) reportMap[productId] = {};

            const dayValuesMap = {};
            if (prodDoc.days) {
                Object.keys(prodDoc.days).forEach(dayKey => {
                    dayValuesMap[dayKey] = prodDoc.days[dayKey];
                });
            }

            Object.keys(prodDoc).forEach(key => {
                if (key.startsWith('days.')) {
                    const dayKey = key.split('.')[1];
                    if (!dayValuesMap[dayKey]) dayValuesMap[dayKey] = prodDoc[key];
                }
            });

            Object.keys(dayValuesMap).forEach(dayKey => {
                const dayNumber = parseInt(dayKey);
                if (!isNaN(dayNumber)) {
                    const val = Number(dayValuesMap[dayKey][activeFieldForUI] || 0);
                    reportMap[productId][dayNumber] = (reportMap[productId][dayNumber] || 0) + val;
                }
            });
        });
    }

    const relevantProducts = products.filter(p => {
        const isSalesItem = p.isSales === true || p.isSales === "true";
        return activeFieldForUI === 'sales' ? isSalesItem : !isSalesItem;
    });

    let displayProducts = [];
    const roots = relevantProducts.filter(p => !p.parentProduct);
    const getChildren = (parentId) => relevantProducts.filter(p => p.parentProduct === parentId);

    if (activeFieldForUI === 'sales') {
        displayProducts = products;
    } else if (['received', 'transfer', 'openingStock'].includes(activeFieldForUI)) {
        displayProducts = roots;
    } else {
        roots.forEach(root => {
            const children = getChildren(root.id);
            if (children.length > 0) {
                children.forEach(c => displayProducts.push({ ...c, _parentName: root.name }));
            } else {
                displayProducts.push(root);
            }
        });
    }

    const getFieldData = (fieldValue, fieldLabel, targetBranchId) => {
        const tempReportMap = {};

        monthlyData.filter(d => d.branchId === targetBranchId).forEach(prodDoc => {
            const productId = prodDoc.productId;
            if (!productId) return;

            if (!tempReportMap[productId]) tempReportMap[productId] = {};

            let dayValuesMap = {};
            if (prodDoc.days) {
                Object.keys(prodDoc.days).forEach(dayKey => {
                    dayValuesMap[dayKey] = prodDoc.days[dayKey];
                });
            }
            Object.keys(prodDoc).forEach(key => {
                if (key.startsWith('days.')) {
                    const dayKey = key.split('.')[1];
                    if (!dayValuesMap[dayKey]) {
                        dayValuesMap[dayKey] = prodDoc[key];
                    }
                }
            });

            Object.keys(dayValuesMap).forEach(dayKey => {
                const dayNumber = parseInt(dayKey);
                if (!isNaN(dayNumber)) {
                    const val = Number(dayValuesMap[dayKey][fieldValue] || 0);
                    tempReportMap[productId][dayNumber] = (tempReportMap[productId][dayNumber] || 0) + val;
                }
            });
        });

        const relevantProducts = products.filter(p => {
            const isSalesItem = p.isSales === true || p.isSales === "true";
            if (fieldValue === 'sales') return isSalesItem;
            return !isSalesItem;
        });

        let tempDisplayProducts = [];
        const roots = relevantProducts.filter(p => !p.parentProduct);
        const getChildren = (parentId) => relevantProducts.filter(p => p.parentProduct === parentId);

        if (fieldValue === 'sales') {
            tempDisplayProducts = products;
        } else if (['received', 'transfer', 'openingStock'].includes(fieldValue)) {
            tempDisplayProducts = roots;
        } else {
            roots.forEach(root => {
                const children = getChildren(root.id);
                if (children.length > 0) {
                    children.forEach(c => {
                        tempDisplayProducts.push({ ...c, _parentName: root.name });
                    });
                } else {
                    tempDisplayProducts.push(root);
                }
            });
        }

        const wsData = [];
        // Add Header for the section
        const branchNameLabel = branches?.find(b => b.id === targetBranchId)?.name || targetBranchId;
        wsData.push([`--- ${fieldLabel} (${branchNameLabel}) ---`]);
        const header = ["المنتج", ...days.map(d => `${d}`), "الإجمالي"];
        wsData.push(header);

        tempDisplayProducts.forEach(prod => {
            const name = prod._parentName ? `${prod._parentName} / ${prod.name}` : prod.name;
            const row = [name];
            let rowTotal = 0;
            days.forEach(day => {
                const val = tempReportMap[prod.id]?.[day];
                const numericVal = Number(val) || 0;
                row.push(numericVal);
                rowTotal += numericVal;
            });
            row.push(rowTotal);
            wsData.push(row);
        });

        return wsData;
    };

const handleExportExcel = async () => {
    // 🛑 شرط الأمان الجديد: التأكد من اختيار حقول، فروع، وأصناف (منتجات) أيضاً
    if (selectedFields.length === 0 || selectedBranches.length === 0 || selectedproducts.length === 0) return;

    const workbook = new ExcelJS.Workbook();

    selectedBranches.forEach(bId => {
        const bName = branches?.find(b => b.id === bId)?.name || bId;
        let combinedData = [];

        let headerPositions = [];
        let currentLine = 1;

        selectedFields.forEach((field) => {
            const fieldLabel = fieldOptions.find(f => f.value === field)?.label || field;
            
            // 1. جلب البيانات الخام للحقل والفرع الحاليين
            let fieldData = getFieldData(field, fieldLabel, bId);
            
            // 2. 🛠️ فلترة البيانات بناءً على "نوع الأصناف" المختارة فقط
            if (fieldData && fieldData.length > 2) {
                const header1 = fieldData[0]; // العنوان الرئيسي (دمج)
                const header2 = fieldData[1]; // عناوين الأعمدة (المنتج، الأيام...)
                
                // تصفية صفوف المنتجات (تبدأ من المؤشر 2 فما فوق)
                const filteredRows = fieldData.slice(2).filter(row => {
                    // إذا كان السطر فارغاً (سطر الفصل مثلاً) نتخطى الفلترة
                    if (!row || row.length === 0) return false;
                    
                    // نأخذ اسم المنتج أو الـ ID الخاص به (العمود الأول وعادة ما يكون row[0])
                    const productName = row[0]; 
                    
                    // البحث في قائمة المنتجات الكلية لمطابقة الاسم مع الـ IDs المحددة في selectedproducts
                    const productObj = products.find(p => p.name === productName || p.id === productName);
                    
                    // إذا وجدنا المنتج وكان معرّفه موجوداً ضمن قائمة المحدد، نبقيه في الجدول
                    return productObj ? selectedproducts.includes(productObj.id) : false;
                });

                // إعادة بناء مصفوفة البيانات لهذا الحقل (العنوان العلوي + الأيام + المنتجات المفلترة فقط)
                if (filteredRows.length > 0) {
                    fieldData = [header1, header2, ...filteredRows];
                } else {
                    fieldData = []; // إذا لم يطابق أي منتج، لا نعرض هذا الجدول
                }
            }

            // إذا كان هناك بيانات بعد الفلترة، نقوم بجدولتها
            if (fieldData && fieldData.length > 0) {
                headerPositions.push({
                    titleRow: currentLine,
                    subHeaderRow: currentLine + 1
                });
                
                combinedData = [...combinedData, ...fieldData, []];
                currentLine += fieldData.length + 1;
            }
        });

        // إذا كان هناك بيانات متبقية للفرع بالكامل بعد التصفية، نقوم بإنشاء الورقة وتنسيقها
        if (combinedData.length > 0) {
            let sheetName = bName.substring(0, 31);
            const worksheet = workbook.addWorksheet(sheetName);

            worksheet.views = [{ showGridLines: true }];
            worksheet.addRows(combinedData);

            let maxColumnKey = 1;
            worksheet.eachRow((row) => {
                if (row.cellCount > maxColumnKey) maxColumnKey = row.cellCount;
            });
            const lastColumnLetter = worksheet.getColumn(maxColumnKey).letter;

            // تلوين الترويسات الخضراء
            headerPositions.forEach(pos => {
                try { worksheet.mergeCells(`A${pos.titleRow}:${lastColumnLetter}${pos.titleRow}`); } catch (e) {}
                
                const titleCell = worksheet.getCell(`A${pos.titleRow}`);
                titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B050' } };
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

            // تنسيق البيانات والـ Zebra والـ DataBars والحدود والسالب
            worksheet.eachRow((row, rowNumber) => {
                const isHeader = headerPositions.some(pos => rowNumber === pos.titleRow || rowNumber === pos.subHeaderRow);
                const isEmptyRow = row.values.every(v => v === null || v === undefined || v === '');

                if (!isHeader && !isEmptyRow) {
                    dataRowIndex++;
                    const rowBgColor = dataRowIndex % 2 === 0 ? 'FFF2F2F2' : 'FFFFFFFF'; // الرمادي الأكثر غماقة بناءً على طلبك السابق

                    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                        cell.border = {
                            top: { style: 'thin', color: { argb: 'FF000000' } },
                            left: { style: 'thin', color: { argb: 'FF000000' } },
                            bottom: { style: 'thin', color: { argb: 'FF000000' } },
                            right: { style: 'thin', color: { argb: 'FF000000' } }
                        };
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };

                        if (colNumber !== maxColumnKey) {
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBgColor } };
                            cell.font = { name: 'Segoe UI', color: { argb: 'FF000000' } };
                        }

                        if (typeof cell.value === 'number') {
                            if (cell.value === 0) {
                                cell.value = '';
                            } else if (cell.value < 0) {
                                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
                                cell.font = { name: 'Segoe UI', color: { argb: 'FFFFFFFF' }, bold: true };
                                cell.numFmt = '#,##0;[White]-#,##0;""';
                            } else {
                                cell.numFmt = '#,##0;;""';
                            }
                        }
                    });

                    // تلوين الإجمالي بالأخضر الفاتح
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

                    // إضافة الـ Data Bars
                    worksheet.addConditionalFormatting({
                        ref: `B${rowNumber}:${worksheet.getColumn(maxColumnKey - 1).letter}${rowNumber}`, 
                        rules: [
                            {
                                type: 'dataBar',
                                minLength: 0,
                                maxLength: 100,
                                showValue: true,
                                cfvo: [{ type: 'min' }, { type: 'max' }],
                                color: { argb: 'FF4F81BD' }
                            }
                        ]
                    });
                }
            });

            // ضبط عرض الأعمدة الصارم والملموم
            worksheet.columns.forEach((column, colIndex) => {
                if (colIndex === 0) {
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
                    column.width = 10;
                } else {
                    column.width = 5.5;
                }
            });
        }
    });

    let fieldsName = selectedFields.length === 1 ? `_${fieldOptions.find(f => f.value === selectedFields[0])?.label}` : `_بيانات_متعددة`;
    const reportName = selectedBranches.length > 1 ? "فروع_محددة" : branchName;
    const fileName = `تقرير_${reportName}${fieldsName}_${selectedMonth}.xlsx`;

    try {
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, fileName);
    } catch (error) {
        console.error("خطأ أثناء تصدير ملف إكسيل:", error);
    }
};
    // const handleExportExcel = () => {
    //     if (selectedFields.length === 0 || selectedBranches.length === 0) return;

    //     const wb = XLSX.utils.book_new();

    //     selectedBranches.forEach(bId => {
    //         const bName = branches?.find(b => b.id === bId)?.name || bId;
    //         let combinedData = [];

    //         selectedFields.forEach((field) => {
    //             const fieldLabel = fieldOptions.find(f => f.value === field)?.label || field;
    //             const fieldData = getFieldData(field, fieldLabel, bId);
    //             // Combine into single sheet for this specific branch
    //             combinedData = [...combinedData, ...fieldData, []];
    //         });

    //         const ws = XLSX.utils.aoa_to_sheet(combinedData);
    //         let sheetName = bName.substring(0, 31);
    //         XLSX.utils.book_append_sheet(wb, ws, sheetName);
    //     });

    //     // Generate file name based on selections
    //     let fieldsName = selectedFields.length === 1 ? `_${fieldOptions.find(f => f.value === selectedFields[0])?.label}` : `_بيانات_متعددة`;
    //     const reportName = selectedBranches.length > 1 ? "فروع_محددة" : branchName;

    //     // Write exactly ONE file to prevent browser blocking multiple downloads
    //     XLSX.writeFile(wb, `تقرير_${reportName}${fieldsName}_${selectedMonth}.xlsx`);
    // };

    return (
        <div className="report-container" style={{ padding: '1rem', direction: 'rtl' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h2 style={{ margin: 0, color: 'hsl(var(--color-primary))', fontSize: '1.5rem' }}>
                    تقارير المخزون الشهرية - {branchName}
                </h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                    <button onClick={onClose} className="btn" style={{ backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }}>إغلاق</button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#475569', fontWeight: 'bold' }}>الفروع المختارة</label>
    <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '0.5rem', backgroundColor: '#fff' }}>
        
        {/* ---- خيار تحديد الكل للفروع ---- */}
        {branches && branches.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0 6px 0', fontSize: '11px', fontWeight: 'bold', borderBottom: '1px dashed #cbd5e1', marginBottom: '4px' }}>
                <input
                    type="checkbox"
                    // يكون محدد تلقائياً إذا كان عدد الفروع المختارة يساوي العدد الكلي للفروع المتاحة
                    checked={selectedBranches.length === branches.length}
                    onChange={(e) => {
                        if (e.target.checked) {
                            // تحديد كافة معرفات (IDs) الفروع
                            setSelectedBranches(branches.map(b => b.id));
                        } else {
                            // إلغاء تحديد كل الفروع
                            setSelectedBranches([]);
                        }
                    }}
                />
                تحديد الكل
            </label>
        )}

        {/* ---- قائمة الفروع الافتراضية ---- */}
        {branches && branches.map(b => (
            <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '11px' }}>
                <input
                    type="checkbox"
                    checked={selectedBranches.includes(b.id)}
                    onChange={(e) => {
                        if (e.target.checked) setSelectedBranches([...selectedBranches, b.id]);
                        else setSelectedBranches(selectedBranches.filter(id => id !== b.id));
                    }}
                />
                {b.name}
            </label>
        ))}
    </div>
</div>

                <div className="input-group" style={{ marginBottom: 0 }}>
    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#475569', fontWeight: 'bold' }}>نوع البيانات</label>
    <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '0.5rem', backgroundColor: '#fff' }}>
        
        {/* ---- خيار تحديد الكل ---- */}
        {fieldOptions.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0 6px 0', fontSize: '11px', fontWeight: 'bold', borderBottom: '1px dashed #cbd5e1', marginBottom: '4px' }}>
                <input
                    type="checkbox"
                    // يكون محدد إذا كان طول المصفوفة المحددة يساوي طول المصفوفة الكلية
                    checked={selectedFields.length === fieldOptions.length}
                    onChange={(e) => {
                        if (e.target.checked) {
                            // تحديد كل القيم
                            setSelectedFields(fieldOptions.map(f => f.value));
                        } else {
                            // إلغاء تحديد الكل (مصفوفة فارغة)
                            setSelectedFields([]);
                        }
                    }}
                />
                تحديد الكل
            </label>
        )}

        {/* ---- قائمة الحقول الافتراضية ---- */}
        {fieldOptions.map(f => (
            <label key={f.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '11px' }}>
                <input
                    type="checkbox"
                    checked={selectedFields.includes(f.value)}
                    onChange={(e) => {
                        if (e.target.checked) setSelectedFields([...selectedFields, f.value]);
                        else setSelectedFields(selectedFields.filter(v => v !== f.value));
                    }}
                />
                {f.label}
            </label>
        ))}
    </div>
</div>


<div className="input-group" style={{ marginBottom: 0 }}>
    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#475569', fontWeight: 'bold' }}>نوع الاصناف</label>
    <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '0.5rem', backgroundColor: '#fff' }}>
        
        {/* ---- خيار تحديد الكل ---- */}
        {products && products.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0 6px 0', fontSize: '11px', fontWeight: 'bold', borderBottom: '1px dashed #cbd5e1', marginBottom: '4px' }}>
                <input
                    type="checkbox"
                    // التحقق من أن جميع معرّفات المنتجات موجودة في قائمة المحدد
                    checked={selectedproducts.length === products.length}
                    onChange={(e) => {
                        if (e.target.checked) {
                            // تم التعديل هنا: نأخذ f.id ليتوافق مع بقية الكود
                            setSelectedProducts(products.map(f => f.id));
                        } else {
                            // تم تصحيح اسم الدالة هنا لإلغاء تحديد الكل بأمان
                            setSelectedProducts([]);
                        }
                    }}
                />
                تحديد الكل
            </label>
        )}

        {/* ---- قائمة المنتجات الافتراضية ---- */}
        {products && products.map(f => (
            <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '11px' }}>
                <input
                    type="checkbox"
                    checked={selectedproducts.includes(f.id)}
                    onChange={(e) => {
                        if (e.target.checked) {
                            setSelectedProducts([...selectedproducts, f.id]);
                        } else {
                            setSelectedProducts(selectedproducts.filter(v => v !== f.id));
                        }
                    }}
                />
                {f.name}
            </label>
        ))}
    </div>
</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '1.5rem' }}>
                <button
                    onClick={handleFetchData}
                    className="btn"
                    disabled={loading || selectedBranches.length === 0}
                    style={{
                        backgroundColor: (loading || selectedBranches.length === 0) ? '#94a3b8' : 'hsl(var(--color-primary))',
                        color: 'white',
                        padding: '0.75rem 2rem',
                        fontWeight: 'bold',
                        fontSize: '1rem'
                    }}
                >
                    {loading ? 'جاري جلب البيانات...' : 'بحث واستخراج البيانات'}
                </button>
                {dataFetched && (
                    <button
                        onClick={handleExportExcel}
                        className="btn"
                        style={{ backgroundColor: '#10b981', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: '5px' }}
                    >
                        <span>📊</span> تصدير Excel
                    </button>
                )}


                {hasUnsavedChanges && (
                    <button
                        onClick={handleSaveChangesToDB}
                        className="btn"
                        disabled={isUpdating}
                        style={{
                            backgroundColor: '#10b981',
                            color: 'white',
                            padding: '0.75rem 2rem',
                            fontWeight: 'bold',
                            fontSize: '1rem',
                            border: 'none',
                            boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.2)'
                        }}
                    >
                        {isUpdating ? 'جاري الحفظ...' : '💾 حفظ التعديلات في القاعدة'}
                    </button>
                )}
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '3rem' }}>
                    <div style={{ width: '30px', height: '30px', border: '3px solid #f3f3f3', borderTop: '3px solid var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }}></div>
                    <p style={{ color: '#64748b' }}>جاري جلب البيانات...</p>
                </div>
            ) : !dataFetched ? (
                <div style={{ textAlign: 'center', padding: '5rem', color: '#64748b', border: '1px dashed #e2e8f0', borderRadius: '8px' }}>
                    <p style={{ fontSize: '1.1rem' }}>الرجاء تحديد الفروع وأنواع البيانات ثم النقر على بحث واستخراج البيانات.</p>
                </div>
            ) : displayProducts.length === 0 ? (
                <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>لا توجد بيانات للعرض.</p>
            ) : (
                <div style={{ overflowX: 'auto', maxHeight: '70vh', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'center' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#f8fafc', color: '#475569' }}>
                                <th style={{ position: 'sticky', left: 0, backgroundColor: '#f8fafc', padding: '10px', borderBottom: '2px solid #e2e8f0', borderRight: '1px solid #e2e8f0', minWidth: '180px', zIndex: 10, textAlign: 'right' }}>المنتج</th>
                                {days.map(day => (
                                    <th key={day} style={{ padding: '10px', borderBottom: '2px solid #e2e8f0', borderLeft: '1px solid #f1f5f9', minWidth: '35px' }}>{day}</th>
                                ))}
                                <th style={{ padding: '10px', borderBottom: '2px solid #e2e8f0', borderLeft: '1px solid #f1f5f9', minWidth: '60px', backgroundColor: '#f1f5f9', fontWeight: '800' }}>الإجمالي</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayProducts.map((prod, idx) => (
                                <tr key={prod.id} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: idx % 2 === 0 ? '#fff' : '#fcfdfe' }}>
                                    <td style={{ position: 'sticky', left: 0, backgroundColor: idx % 2 === 0 ? '#fff' : '#fcfdfe', padding: '8px 12px', borderRight: '1px solid #e2e8f0', textAlign: 'right', zIndex: 5 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            {prod._parentName ? (
                                                <span><small style={{ color: '#94a3b8', fontSize: '9px' }}>{prod._parentName} / </small>{prod.name}</span>
                                            ) : (
                                                <span style={{ fontWeight: prod.parentProduct ? 'normal' : '600' }}>{prod.name}</span>
                                            )}
                                            <button
                                                onClick={() => onOpenCorrection(prod)}
                                                style={{
                                                    background: 'hsl(var(--color-primary))',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    fontSize: '9px',
                                                    padding: '2px 6px',
                                                    marginLeft: '4px',
                                                    whiteSpace: 'nowrap'
                                                }}
                                            >
                                                ⚙️
                                            </button>
                                        </div>
                                    </td>
                                    {days.map(day => (
                                        <td key={day} style={{ padding: '8px 4px', borderLeft: '1px solid #f1f5f9' }}>
                                            {reportMap[prod.id]?.[day] || 0}
                                        </td>
                                    ))}
                                    <td style={{ padding: '8px 4px', borderLeft: '1px solid #f1f5f9', backgroundColor: '#f8fafc', fontWeight: 'bold', color: 'hsl(var(--color-primary))' }}>
                                        {days.reduce((sum, day) => sum + (Number(reportMap[prod.id]?.[day]) || 0), 0)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default MonthlyBranchReport;


