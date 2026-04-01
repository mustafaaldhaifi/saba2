import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from '../../config/firebase';
import * as XLSX from 'xlsx';

const MonthlyBranchReport = ({ branchId, city, typeId, products, onClose, branchName }) => {
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7)); // YYYY-MM
    const [selectedField, setSelectedField] = useState(''); // Default to empty
    const [monthlyData, setMonthlyData] = useState([]);
    const [loading, setLoading] = useState(false);

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
        { value: 'closeStock', label: 'المتبقي' },
        { value: 'all', label: 'الكل (في ملف واحد)' },
    ];

    useEffect(() => {
        const fetchMonthlyData = async () => {
            if (!branchId || !selectedMonth) return;
            setLoading(true);
            try {
                // Fetch from product_monthly_summaries
                // Criteria: productId implicitly via products list, branchId and month as specified
                const q = query(
                    collection(db, "product_monthly_summaries"),
                    where("branchId", "==", branchId),
                    where("month", "==", selectedMonth)
                );

                const snapshot = await getDocs(q);
                const data = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                console.log('Fetched Data:', data);
                setMonthlyData(data);
            } catch (error) {
                console.error("Error fetching monthly data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchMonthlyData();
    }, [branchId, selectedMonth]);

    // Generate days of the month
    const [year, month] = selectedMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    // Group data by product and day
    const reportMap = {};

    monthlyData.forEach(prodDoc => {
        const productId = prodDoc.productId;
        if (!productId) return;

        if (!reportMap[productId]) reportMap[productId] = {};

        // Handle Case 1: Standard nested object { days: { "11": { ... } } }
        if (prodDoc.days) {
            Object.keys(prodDoc.days).forEach(dayKey => {
                const dayNumber = parseInt(dayKey);
                if (!isNaN(dayNumber)) {
                    const dayValues = prodDoc.days[dayKey];
                    const val = dayValues[selectedField];
                    reportMap[productId][dayNumber] = (val !== undefined && val !== null) ? val : '-';
                }
            });
        }

        // Handle Case 2: Dot notation keys from Firestore { "days.11": { ... } }
        // This happens when using merge: true with dynamic keys in some batch operations
        Object.keys(prodDoc).forEach(key => {
            if (key.startsWith('days.')) {
                const dayKey = key.split('.')[1];
                const dayNumber = parseInt(dayKey);

                if (!isNaN(dayNumber)) {
                    const dayValues = prodDoc[key];
                    const val = dayValues[selectedField];
                    // Only set if not already set by Case 1 to avoid conflicts
                    if (reportMap[productId][dayNumber] === undefined || reportMap[productId][dayNumber] === '-') {
                        reportMap[productId][dayNumber] = (val !== undefined && val !== null) ? val : '-';
                    }
                }
            }
        });
    });
    console.log('Report Map processed:', reportMap);

    // 1. Filter products based on selection (Mutual Exclusion)
    const relevantProducts = products.filter(p => {
        const isSalesItem = p.isSales === true || p.isSales === "true";

        if (selectedField === 'sales') {
            // Show only sales products
            return isSalesItem;
        } else {
            // Show only inventory products (non-sales)
            return !isSalesItem;
        }
    });

    // 2. Define Display Logic and Grouping
    let displayProducts = [];
    const roots = relevantProducts.filter(p => !p.parentProduct);
    const getChildren = (parentId) => relevantProducts.filter(p => p.parentProduct === parentId);

    if (selectedField === 'sales') {
        // "Show them all/fully": Show all sales products as a flat list
        displayProducts = products;
    } else if (['received', 'transfer', 'openingStock'].includes(selectedField)) {
        // For these inventory views, show only root products (materials/parents)
        displayProducts = roots;
    } else {
        // Standard grouping logic: if parent has children, show children. If not, show root.
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

    const getFieldData = (fieldValue, fieldLabel) => {
        const tempReportMap = {};

        monthlyData.forEach(prodDoc => {
            const productId = prodDoc.productId;
            if (!productId) return;

            if (!tempReportMap[productId]) tempReportMap[productId] = {};

            if (prodDoc.days) {
                Object.keys(prodDoc.days).forEach(dayKey => {
                    const dayNumber = parseInt(dayKey);
                    if (!isNaN(dayNumber)) {
                        const dayValues = prodDoc.days[dayKey];
                        const val = dayValues[fieldValue];
                        tempReportMap[productId][dayNumber] = (val !== undefined && val !== null) ? val : '-';
                    }
                });
            }

            Object.keys(prodDoc).forEach(key => {
                if (key.startsWith('days.')) {
                    const dayKey = key.split('.')[1];
                    const dayNumber = parseInt(dayKey);

                    if (!isNaN(dayNumber)) {
                        const dayValues = prodDoc[key];
                        const val = dayValues[fieldValue];
                        if (tempReportMap[productId][dayNumber] === undefined || tempReportMap[productId][dayNumber] === '-') {
                            tempReportMap[productId][dayNumber] = (val !== undefined && val !== null) ? val : '-';
                        }
                    }
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
        wsData.push([`--- ${fieldLabel} ---`]);
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
        if (!selectedField) return;

        const wb = XLSX.utils.book_new();

        if (selectedField === 'all') {
            let combinedData = [];
            const actualFields = fieldOptions.filter(f => f.value !== 'all');
            
            actualFields.forEach((field) => {
                const fieldData = getFieldData(field.value, field.label);
                combinedData = [...combinedData, ...fieldData, []]; // Add empty row as spacer
            });

            const ws = XLSX.utils.aoa_to_sheet(combinedData);
            XLSX.utils.book_append_sheet(wb, ws, "تقرير شامل");
            XLSX.writeFile(wb, `Report_All_${branchName}_${selectedMonth}.xlsx`);
        } else {
            const fieldLabel = fieldOptions.find(f => f.value === selectedField)?.label || selectedField;
            const fieldData = getFieldData(selectedField, fieldLabel);
            const ws = XLSX.utils.aoa_to_sheet(fieldData);
            XLSX.utils.book_append_sheet(wb, ws, fieldLabel.substring(0, 31));
            XLSX.writeFile(wb, `Report_${branchName}_${selectedMonth}_${fieldLabel}.xlsx`);
        }
    };

    return (
        <div className="card" style={{ marginTop: '1rem', padding: '1.5rem', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h3 style={{ margin: 0, color: 'hsl(var(--color-primary))', fontSize: '1.25rem' }}>
                        تقرير الشهر كامل - {branchName}
                    </h3>
                    <p style={{ margin: '5px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                        عرض <strong>{fieldOptions.find(f => f.value === selectedField)?.label}</strong> لكل يوم
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                        onClick={handleExportExcel}
                        className="btn"
                        style={{ backgroundColor: '#10b981', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: '5px' }}
                    >
                        <span>📊</span> تصدير Excel
                    </button>
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

                    <div className="input-group" style={{ marginBottom: 0, width: 'auto' }}>
                        <label style={{ display: 'block', marginBottom: '2px', fontSize: '11px', color: '#64748b' }}>نوع البيانات</label>
                        <select
                            className="input-field"
                            value={selectedField}
                            onChange={(e) => setSelectedField(e.target.value)}
                            style={{ padding: '0.5rem', fontSize: '0.9rem', backgroundColor: '#fff' }}
                        >
                            <option value="">-- اختر نوع البيانات --</option>
                            {fieldOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
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

            {selectedField === 'all' ? (
                <div style={{ textAlign: 'center', padding: '5rem', color: '#64748b', border: '1px dashed #e2e8f0', borderRadius: '8px' }}>
                    <p style={{ fontSize: '1.1rem' }}>لقد اخترت <strong>الكل</strong>. سيتم تصدير كافة أنواع البيانات في ملف اكسل واحد مرتبة تحت بعضها عند النقر على زر التصدير.</p>
                </div>
            ) : !selectedField ? (
                <div style={{ textAlign: 'center', padding: '5rem', color: '#64748b', border: '1px dashed #e2e8f0', borderRadius: '8px' }}>
                    <p style={{ fontSize: '1.1rem' }}>يرجى اختيار <strong>نوع البيانات</strong> من القائمة بالأعلى لعرض التقرير.</p>
                </div>
            ) : loading ? (
                <div style={{ textAlign: 'center', padding: '3rem' }}>
                    <div style={{ width: '30px', height: '30px', border: '3px solid #f3f3f3', borderTop: '3px solid var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }}></div>
                    <p style={{ color: '#64748b' }}>جاري جلب البيانات من سجلات الشهر...</p>
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
