import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from '../../config/firebase';
import * as XLSX from 'xlsx';

const MonthlyBranchReport = ({ branchId, branches, city, typeId, products, onClose, branchName }) => {
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7)); // YYYY-MM
    const [selectedBranches, setSelectedBranches] = useState([branchId]);
    const [selectedFields, setSelectedFields] = useState([]); // Default to empty
    const [monthlyData, setMonthlyData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [dataFetched, setDataFetched] = useState(false);
    const fieldOptions = [
        { value: 'received', label: 'المستلم' },
        { value: 'add', label: 'الجرد' },
        { value: 'sales', label: 'مبيعات' },
        { value: 'staffMeal', label: 'وجبة موظف' },
        { value: 'damaged', label: 'التالف' },
        { value: 'canceled', label: 'الملغي' },
        { value: 'openingStock', label: 'الرصيد الموجود' },
        { value: 'transfer', label: 'تحويل' },
        { value: 'directTransfer', label: 'تجهيز مباشر' },
        { value: 'freeIncrease', label: 'تعويض زبون' },
        { value: 'closeStock', label: 'المتبقي' }
    ];

    useEffect(() => {
        setDataFetched(false);
        setMonthlyData([]);
    }, [selectedBranches, selectedMonth]);

    const handleFetchData = async () => {
        if (selectedBranches.length === 0 || !selectedMonth) {
            alert("يرجى اختيار فرع واحد على الأقل وشهر صحيح");
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
            console.log('Fetched Data for branches:', allData);
            setMonthlyData(allData);
            setDataFetched(true);
        } catch (error) {
            console.error("Error fetching monthly data:", error);
            alert("حدث خطأ أثناء جلب البيانات");
        } finally {
            setLoading(false);
        }
    };

    // Generate days of the month
    const [year, month] = selectedMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    // Group data by product and day
    const reportMap = {};
    const activeFieldForUI = (selectedFields.length === 1 && selectedBranches.length === 1) ? selectedFields[0] : null;

    if (activeFieldForUI) {
        monthlyData.forEach(prodDoc => {
            const productId = prodDoc.productId;
            if (!productId) return;

            if (!reportMap[productId]) reportMap[productId] = {};

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
                    const val = Number(dayValuesMap[dayKey][activeFieldForUI] || 0);
                    reportMap[productId][dayNumber] = (reportMap[productId][dayNumber] || 0) + val;
                }
            });
        });
    }
    console.log('Report Map processed:', reportMap);

    // 1. Filter products based on selection
    const relevantProducts = products.filter(p => {
        const isSalesItem = p.isSales === true || p.isSales === "true";

        if (activeFieldForUI === 'sales') {
            return isSalesItem;
        } else {
            return !isSalesItem;
        }
    });

    // 2. Define Display Logic and Grouping
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
                children.forEach(c => {
                    displayProducts.push({ ...c, _parentName: root.name });
                });
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
        const header = ["المنتج", ...days.map(d => `${d}`)];
        wsData.push(header);

        tempDisplayProducts.forEach(prod => {
            const name = prod._parentName ? `${prod._parentName} / ${prod.name}` : prod.name;
            const row = [name];
            days.forEach(day => {
                const val = tempReportMap[prod.id]?.[day];
                row.push(val === '-' ? 0 : val);
            });
            wsData.push(row);
        });

        return wsData;
    };

    const handleExportExcel = () => {
        if (selectedFields.length === 0 || selectedBranches.length === 0) return;

        const wb = XLSX.utils.book_new();

        selectedBranches.forEach(bId => {
            const bName = branches?.find(b => b.id === bId)?.name || bId;
            let combinedData = [];
            
            selectedFields.forEach((field) => {
                const fieldLabel = fieldOptions.find(f => f.value === field)?.label || field;
                const fieldData = getFieldData(field, fieldLabel, bId);
                // Combine into single sheet for this specific branch
                combinedData = [...combinedData, ...fieldData, []];
            });

            const ws = XLSX.utils.aoa_to_sheet(combinedData);
            let sheetName = bName.substring(0, 31);
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        });

        // Generate file name based on selections
        let fieldsName = selectedFields.length === 1 ? `_${fieldOptions.find(f => f.value === selectedFields[0])?.label}` : `_بيانات_متعددة`;
        const reportName = selectedBranches.length > 1 ? "فروع_محددة" : branchName;
        
        // Write exactly ONE file to prevent browser blocking multiple downloads
        XLSX.writeFile(wb, `تقرير_${reportName}${fieldsName}_${selectedMonth}.xlsx`);
    };

    return (
        <div className="card" style={{ marginTop: '1rem', padding: '1.5rem', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h3 style={{ margin: 0, color: 'hsl(var(--color-primary))', fontSize: '1.25rem' }}>
                        تقرير الأيام (خلال شهر)
                    </h3>
                    <p style={{ margin: '5px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                        {selectedBranches.length} فرع محدد — {selectedFields.length} نوع بيانات محدد
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {dataFetched && (
                        <button
                            onClick={handleExportExcel}
                            className="btn"
                            style={{ backgroundColor: '#10b981', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: '5px' }}
                        >
                            <span>📊</span> تصدير Excel
                        </button>
                    )}
                    <div className="input-group" style={{ marginBottom: 0, width: 'auto' }}>
                        <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px', color: '#64748b' }}>الشهر</label>
                        <input
                            type="month"
                            className="input-field"
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(e.target.value)}
                            style={{ padding: '0.5rem', fontSize: '0.9rem' }}
                        />
                    </div>

                    <button
                        onClick={onClose}
                        className="btn"
                        style={{ backgroundColor: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', alignSelf: 'flex-end' }}
                    >
                        إغلاق التقرير
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#475569', fontWeight: 'bold' }}>الفروع</label>
                    <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '0.5rem', backgroundColor: '#fff' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderBottom: '1px solid #f1f5f9', fontWeight: 'bold', fontSize: '11px' }}>
                            <input 
                                type="checkbox" 
                                checked={branches && selectedBranches.length === branches.length}
                                onChange={(e) => setSelectedBranches(e.target.checked && branches ? branches.map(b => b.id) : [])}
                            /> 
                            تحديد الكل
                        </label>
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
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderBottom: '1px solid #f1f5f9', fontWeight: 'bold', fontSize: '11px' }}>
                            <input 
                                type="checkbox" 
                                checked={selectedFields.length === fieldOptions.length}
                                onChange={(e) => setSelectedFields(e.target.checked ? fieldOptions.map(f => f.value) : [])}
                            /> 
                            تحديد الكل
                        </label>
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
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '1.5rem' }}>
                <button
                    onClick={handleFetchData}
                    className="btn"
                    disabled={loading || selectedBranches.length === 0}
                    style={{ 
                        backgroundColor: 'hsl(var(--color-primary))', 
                        color: 'white', 
                        padding: '0.75rem 3rem', 
                        fontWeight: 'bold',
                        fontSize: '1.1rem',
                        opacity: (loading || selectedBranches.length === 0) ? 0.7 : 1
                    }}
                >
                    {loading ? 'جاري جلب البيانات...' : 'بحث واستخراج البيانات'}
                </button>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '3rem' }}>
                    <div style={{ width: '30px', height: '30px', border: '3px solid #f3f3f3', borderTop: '3px solid var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }}></div>
                    <p style={{ color: '#64748b' }}>جاري جلب البيانات من سجلات الشهر للفروع المحددة...</p>
                </div>
            ) : !dataFetched ? (
                <div style={{ textAlign: 'center', padding: '5rem', color: '#64748b', border: '1px dashed #e2e8f0', borderRadius: '8px' }}>
                    <p style={{ fontSize: '1.1rem' }}>الرجاء تحديد الفروع وأنواع البيانات ثم النقر على <strong>بحث واستخراج البيانات</strong> للبدء.</p>
                </div>
            ) : selectedFields.length === 0 || selectedBranches.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '5rem', color: '#64748b', border: '1px dashed #e2e8f0', borderRadius: '8px' }}>
                    <p style={{ fontSize: '1.1rem' }}>يرجى اختيار <strong>نوع بيانات واحد وفرع واحد على الأقل</strong> لعرض التقرير.</p>
                </div>
            ) : selectedFields.length > 1 || selectedBranches.length > 1 ? (
                <div style={{ textAlign: 'center', padding: '5rem', color: '#64748b', border: '1px dashed #e2e8f0', borderRadius: '8px' }}>
                    <p style={{ fontSize: '1.2rem', marginBottom: '10px' }}>لقد قمت باختيار <strong>{selectedBranches.length} فرع</strong> و <strong>{selectedFields.length} أنواع بيانات</strong>.</p>
                    <p style={{ fontSize: '1rem', lineHeight: '1.5' }}>لتجنب تداخل الأرقام، يتم تصدير بيانات كل فرع بشكل مستقل.<br/>يرجى استخدام زر <strong>تصدير Excel</strong> لتنزيل البيانات مفصلة في التبويبات (Sheets).</p>
                </div>
            ) : displayProducts.length === 0 ? (
                <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>لا توجد بيانات للعرض بناءً على الفلاتر المختارة.</p>
            ) : (
                <div style={{ overflowX: 'auto', maxHeight: '70vh', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'center' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#f8fafc', color: '#475569' }}>
                                <th style={{ position: 'sticky', left: 0, backgroundColor: '#f8fafc', padding: '10px', borderBottom: '2px solid #e2e8f0', borderRight: '1px solid #e2e8f0', minWidth: '180px', zIndex: 10, textAlign: 'right' }}>المنتج</th>
                                {days.map(day => (
                                    <th key={day} style={{ padding: '10px', borderBottom: '2px solid #e2e8f0', borderLeft: '1px solid #f1f5f9', minWidth: '35px' }}>{day}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {displayProducts.map((prod, idx) => (
                                <tr key={prod.id} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: idx % 2 === 0 ? '#fff' : '#fcfdfe' }}>
                                    <td style={{
                                        position: 'sticky',
                                        left: 0,
                                        backgroundColor: idx % 2 === 0 ? '#fff' : '#fcfdfe',
                                        padding: '8px 12px',
                                        borderRight: '1px solid #e2e8f0',
                                        textAlign: 'right',
                                        zIndex: 5
                                    }}>
                                        {prod._parentName ? (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                <small style={{ color: '#94a3b8', fontSize: '9px' }}>{prod._parentName} /</small>
                                                {prod.name}
                                            </span>
                                        ) : (
                                            <span style={{ fontWeight: prod.parentProduct ? 'normal' : '600' }}>
                                                {prod.name}
                                            </span>
                                        )}
                                    </td>
                                    {days.map(day => (
                                        <td key={day} style={{ padding: '8px 4px', borderLeft: '1px solid #f1f5f9', color: reportMap[prod.id]?.[day] !== undefined ? '#0f172a' : '#cbd5e1' }}>
                                            {reportMap[prod.id]?.[day] ?? '-'}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <style>{`
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default MonthlyBranchReport;
