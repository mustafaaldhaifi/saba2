import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from '../../config/firebase';
import * as XLSX from 'xlsx';

const GlobalMonthlyReport = ({ branches, typeId, initialMonth, onClose, cityName, products: currentProducts }) => {
    const [selectedMonth, setSelectedMonth] = useState(initialMonth || new Date().toISOString().substring(0, 7));
    const [selectedBranches, setSelectedBranches] = useState(branches.map(b => b.id));
    const [selectedFields, setSelectedFields] = useState(['sales']);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: branches.length, branchName: '' });
    const [completed, setCompleted] = useState(false);
    const [allProducts, setAllProducts] = useState([]);
    const [aggregatedData, setAggregatedData] = useState({}); // { linkId: { branchId: { field: value } } }

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
    ];

    // 1. Fetch All Products for this Type (Full city scope)
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

    const handleStartProcessing = async () => {
        if (!selectedMonth || selectedBranches.length === 0 || selectedFields.length === 0) {
            alert("يرجى اختيار شهر واحد وفرع واحد ونوع بيانات واحد على الأقل");
            return;
        }
        setIsProcessing(true);
        setCompleted(false);
        const results = {}; // Map to store grouped results

        const targetBranches = branches.filter(b => selectedBranches.includes(b.id));

        try {
            for (let i = 0; i < targetBranches.length; i++) {
                const branch = targetBranches[i];
                setProgress({ current: i + 1, total: targetBranches.length, branchName: branch.name });

                // Fetch Monthly Summaries for this branch & month
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

                    // Find product linkId or use productId as fallback
                    const prodInfo = allProducts.find(p => p.id === productId) || currentProducts.find(p => p.id === productId);
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

                    // Collect day values handling both standard maps and dot notation keys
                    let dayValuesMap = {};
                    if (data.days) {
                        Object.keys(data.days).forEach(dayKey => {
                            dayValuesMap[dayKey] = data.days[dayKey];
                        });
                    }
                    Object.keys(data).forEach(key => {
                        if (key.startsWith('days.')) {
                            const dayKey = key.split('.')[1];
                            if (!dayValuesMap[dayKey]) {
                                dayValuesMap[dayKey] = data[key];
                            }
                        }
                    });

                    // Sum the values for all selected fields across all collected days
                    selectedFields.forEach(field => {
                        let totalVal = 0;
                        Object.values(dayValuesMap).forEach(dayVal => {
                            const val = Number(dayVal[field] || 0);
                            totalVal += val;
                        });
                        results[linkId].branches[branch.id][field] = (results[linkId].branches[branch.id][field] || 0) + totalVal;
                    });
                });
            }

            setAggregatedData(results);
            setCompleted(true);
        } catch (error) {
            console.error("Processing error:", error);
            alert("حدث خطأ أثناء معالجة البيانات");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleExport = () => {
        if (Object.keys(aggregatedData).length === 0) return;

        const targetBranches = branches.filter(b => selectedBranches.includes(b.id));
        const wb = XLSX.utils.book_new();
        let combinedData = [];

        selectedFields.forEach(field => {
            const fieldLabel = fieldOptions.find(f => f.value === field)?.label || field;
            
            // 1. Header Row
            const header = ["المنتج", ...targetBranches.map(b => b.name), "الإجمالي العام"];
            combinedData.push([`--- تقرير الفروع - ${selectedMonth} - ${fieldLabel} ---`]);
            combinedData.push(header);

            // 2. Data Rows
            const sortedLinkIds = Object.keys(aggregatedData).sort((a, b) => 
                aggregatedData[a].name.localeCompare(aggregatedData[b].name)
            );

            sortedLinkIds.forEach(linkId => {
                const prod = aggregatedData[linkId];
                
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
                combinedData.push(row);
            });
            
            combinedData.push([]); // Empty row for spacing
        });

        const ws = XLSX.utils.aoa_to_sheet(combinedData);
        XLSX.utils.book_append_sheet(wb, ws, "البيانات الشاملة");

        let fieldsName = selectedFields.length === 1 ? `_${fieldOptions.find(f => f.value === selectedFields[0])?.label}` : `_بيانات_متعددة`;
        XLSX.writeFile(wb, `Global_Report${fieldsName}_${selectedMonth}.xlsx`);
    };

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
                    <h2 style={{ margin: 0, color: 'hsl(var(--color-primary))', fontSize: '1.5rem' }}>التقرير الشهري الشامل لكافة الفروع</h2>
                    <p style={{ margin: '5px 0 0', color: '#64748b' }}>عرض وتصدير إحصائيات المنتجات عبر جميع فروع المملكة</p>
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
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        disabled={isProcessing}
                        style={{ padding: '0.75rem', borderRadius: '8px' }}
                    />
                </div>

                <div className="input-group" style={{ marginBottom: 0 }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#475569' }}>تحديد الفروع</label>
                    <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.5rem', backgroundColor: '#fff' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderBottom: '1px solid #f1f5f9', fontWeight: 'bold' }}>
                            <input 
                                type="checkbox" 
                                checked={selectedBranches.length === branches.length}
                                onChange={(e) => setSelectedBranches(e.target.checked ? branches.map(b => b.id) : [])}
                                disabled={isProcessing}
                            /> 
                            تحديد الكل
                        </label>
                        {branches.map(b => (
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
                                {b.name}
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

            {completed && (
                <div style={{ textAlign: 'center', padding: '2rem', backgroundColor: '#ecfdf5', borderRadius: '12px', border: '1px solid #a7f3d0' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
                    <h3 style={{ color: '#065f46', margin: '0 0 0.5rem 0' }}>اكتملت معالجة البيانات بنجاح!</h3>
                    <p style={{ color: '#047857', marginBottom: '1.5rem' }}>تم تجميع وإجراء الحسابات لكافة المنتجات لعدد {selectedBranches.length} فرع ولعدد {selectedFields.length} نوع(أنواع) بيانات.</p>
                    <button
                        onClick={handleExport}
                        className="btn"
                        style={{ backgroundColor: '#10b981', color: 'white', padding: '1rem 2.5rem', fontSize: '1.1rem', fontWeight: '700' }}
                    >
                        📊 تحميل ملف Excel الشامل
                    </button>
                </div>
            )}
        </div>
    );
};

export default GlobalMonthlyReport;
