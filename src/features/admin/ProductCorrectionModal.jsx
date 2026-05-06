import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, getDoc, doc, runTransaction, Timestamp, serverTimestamp, orderBy, arrayUnion } from "firebase/firestore";
import { db } from '../../config/firebase';
import * as XLSX from 'xlsx';

const ProductCorrectionModal = ({ branchId, productId, typeId, product, allProducts, onClose }) => {
    const [startDate, setStartDate] = useState(new Date().toISOString().substring(0, 10));
    const [loading, setLoading] = useState(false);
    const [correctionData, setCorrectionData] = useState({}); // { dateStr: { ...fields } }
    const [deductionsData, setDeductionsData] = useState({}); // { productId: { dateStr: { ...fields } } }
    const [childrenData, setChildrenData] = useState({}); // { childProductId: { dateStr: { ...fields } } }
    const [isDataReady, setIsDataReady] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [monthlyBaseData, setMonthlyBaseData] = useState({}); // { productId: { month: { dayNum: {...} } } }
    const [initialSnapshot, setInitialSnapshot] = useState({ correction: {}, children: {}, deductions: {} });
    const [showMonthlyPreview, setShowMonthlyPreview] = useState(true);

    // Children of this product
    const childProducts = allProducts?.filter(p => p.parentProduct === productId) || [];

    const handleFetchData = async () => {
        if (!productId || !branchId || !startDate) return;
        setLoading(true);

        try {
            const startStr = startDate;
            const today = new Date();
            // const todayStr = today.toISOString().split('T')[0];
            const todayStr = today.toLocaleDateString('sv-SE');


            // Widen range for safety
            const wideStart = new Date(new Date(startStr).getTime() - 24 * 60 * 60 * 1000);
            const wideEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000);
            const startTs = Timestamp.fromDate(wideStart);
            const endTs = Timestamp.fromDate(wideEnd);

            // --- 1. Fetch Main Product ---
            const qMain = query(
                collection(db, "dailyReports"),
                where("branchId", "==", branchId),
                where("productId", "==", productId),
                where("date", ">=", startTs),
                where("date", "<=", endTs),
                orderBy("date", "asc")
            );
            const mainSnap = await getDocs(qMain);



            const mainDataMap = {};
            mainSnap.docs.forEach(docSnap => {
                const data = docSnap.data();
                console.log("data", data);
                const dDate = data.date.toDate();
                console.log("date1", dDate);
                // const dateKey = dDate.toISOString().split('T')[0];
                const dateKey = dDate.toLocaleDateString('sv-SE');
                console.log("date2", dateKey);
                if (dateKey >= startStr && dateKey <= todayStr) {
                    mainDataMap[dateKey] = {
                        ...data,
                        _docId: docSnap.id,
                        fullDate: dateKey,
                        received: data.recieved ?? data.received ?? 0,
                        damaged: data.dameged ?? data.damaged ?? 0,
                        openingStock: data.openingStockQnt ?? data.openingStock ?? 0,
                        sales: data.sales ?? 0
                    };
                }
            });


            // --- 2. Fetch Deductions and Children Parallely ---
            const deductionIds = (product?.deductions || []).map(d => d.productId);
            const childrenIds = (childProducts || []).map(c => c.id);

            const allSubPromises = [...deductionIds, ...childrenIds].map(async (id) => {
                const q = query(
                    collection(db, "dailyReports"),
                    where("branchId", "==", branchId),
                    where("productId", "==", id),
                    where("date", ">=", startTs),
                    where("date", "<=", endTs),
                    orderBy("date", "asc")
                );
                const snap = await getDocs(q);
                return { id, docs: snap.docs };
            });

            const subResults = await Promise.all(allSubPromises);

            const finalDeductions = {};
            const finalChildren = {};

            // Process Deductions
            (product?.deductions || []).forEach(ded => {
                const res = subResults.find(r => r.id === ded.productId);
                if (!res) return;

                const tempDays = {};
                res.docs.forEach(docSnap => {
                    const d = docSnap.data();
                    const dDate = d.date.toDate();
                    // const dateKey = dDate.toISOString().split('T')[0];
                    const dateKey = dDate.toLocaleDateString('sv-SE');
                    if (dateKey >= startStr && dateKey <= todayStr) {
                        const parentSales = mainDataMap[dateKey]?.sales || 0;
                        const ratio = ded.amount || ded.quantity || 1;

                        tempDays[dateKey] = {
                            ...d,
                            _docId: docSnap.id,
                            _name: allProducts?.find(p => p.id === ded.productId)?.name || 'خصم',
                            directTransfer: parentSales * ratio,
                            received: d.recieved ?? d.received ?? 0,
                            openingStock: d.openingStockQnt ?? d.openingStock ?? 0,
                        };
                    }
                });
                finalDeductions[ded.productId] = recalculateBalances(tempDays);
            });

            // Process Children
            childProducts.forEach(child => {
                const res = subResults.find(r => r.id === child.id);
                if (!res) return;

                const tempDays = {};
                res.docs.forEach(docSnap => {
                    const d = docSnap.data();
                    const dDate = d.date.toDate();
                    // const dateKey = dDate.toISOString().split('T')[0];
                    const dateKey = dDate.toLocaleDateString('sv-SE');
                    if (dateKey >= startStr && dateKey <= todayStr) {
                        tempDays[dateKey] = {
                            ...d,
                            _docId: docSnap.id,
                            _name: child.name,
                            received: d.recieved ?? d.received ?? 0,
                            openingStock: d.openingStockQnt ?? d.openingStock ?? 0,
                        };
                    }
                });
                finalChildren[child.id] = recalculateBalances(tempDays);
            });

            setCorrectionData(mainDataMap);
            setDeductionsData(finalDeductions);
            setChildrenData(finalChildren);
            setIsDataReady(Object.keys(mainDataMap).length > 0);

            console.log("mainDataMap", mainDataMap);


        } catch (error) {
            console.error("Error fetching correction data:", error);
            alert("حدث خطأ أثناء جلب البيانات.");
        } finally {
            setLoading(false);
        }
    };

    const recalculateBalances = (daysMap) => {
        const sortedDates = Object.keys(daysMap).sort();
        let lastClose = null;
        const result = { ...daysMap };

        sortedDates.forEach(date => {
            if (lastClose !== null) result[date].openingStock = lastClose;
            const day = result[date];
            const ins = Number(day.openingStock || 0) + Number(day.received || 0) + Number(day.add || 0) + Number(day.canceled || 0) + Number(day.freeIncrease || 0);
            const outs = Number(day.sales || 0) + Number(day.staffMeal || 0) + Number(day.damaged || 0) + Number(day.transfer || 0) + Number(day.directTransfer || 0);
            day.closeStock = ins - outs;
            lastClose = day.closeStock;
        });
        return result;
    };

    const handleExportExcel = () => {
        if (!isDataReady) return;

        try {
            const wb = XLSX.utils.book_new();

            // 1. Prepare Main Product Data
            const mainRows = Object.keys(correctionData).sort().map(date => {
                const d = correctionData[date];
                return {
                    'التاريخ': date,
                    'المنتج': product?.name,
                    'الموجود': d.openingStock,
                    'المستلم': d.received,
                    'الجرد': d.add,
                    'مبيعات': d.sales,
                    'وجبة موظف': d.staffMeal,
                    'تالف': d.damaged,
                    'مكنسل': d.canceled,
                    'تحويل': d.transfer,
                    'ت. مباشر': d.directTransfer,
                    'ز. مجانية': d.freeIncrease,
                    'المتبقي': d.closeStock
                };
            });
            const wsMain = XLSX.utils.json_to_sheet(mainRows);
            XLSX.utils.book_append_sheet(wb, wsMain, "المنتج الرئيسي");

            // 2. Prepare Children Data
            if (Object.keys(childrenData).length > 0) {
                const childRows = [];
                Object.keys(childrenData).forEach(childId => {
                    const childName = allProducts?.find(p => p.id === childId)?.name || 'ابن';
                    Object.keys(childrenData[childId]).sort().forEach(date => {
                        const d = childrenData[childId][date];
                        childRows.push({
                            'التاريخ': date,
                            'المنتج التابع': childName,
                            'الموجود': d.openingStock,
                            'المستلم': d.received,
                            'الجرد': d.add,
                            'مبيعات': d.sales,
                            'وجبة موظف': d.staffMeal,
                            'تالف': d.damaged,
                            'مكنسل': d.canceled,
                            'تحويل': d.transfer,
                            'ت. مباشر': d.directTransfer,
                            'ز. مجانية': d.freeIncrease,
                            'المتبقي': d.closeStock
                        });
                    });
                });
                const wsChildren = XLSX.utils.json_to_sheet(childRows);
                XLSX.utils.book_append_sheet(wb, wsChildren, "المنتجات التابعة");
            }

            // 3. Prepare Deductions Data
            if (Object.keys(deductionsData).length > 0) {
                const dedRows = [];
                Object.keys(deductionsData).forEach(dedId => {
                    const dedName = allProducts?.find(p => p.id === dedId)?.name || 'خصم';
                    Object.keys(deductionsData[dedId]).sort().forEach(date => {
                        const d = deductionsData[dedId][date];
                        dedRows.push({
                            'التاريخ': date,
                            'منتج الخصم': dedName,
                            'الموجود': d.openingStock,
                            'المستلم': d.received,
                            'الجرد': d.add,
                            'مبيعات': d.sales,
                            'وجبة موظف': d.staffMeal,
                            'تالف': d.damaged,
                            'مكنسل': d.canceled,
                            'تحويل': d.transfer,
                            'ت. مباشر': d.directTransfer,
                            'ز. مجانية': d.freeIncrease,
                            'المتبقي': d.closeStock
                        });
                    });
                });
                const wsDeds = XLSX.utils.json_to_sheet(dedRows);
                XLSX.utils.book_append_sheet(wb, wsDeds, "الخصومات");
            }

            XLSX.writeFile(wb, `تصحيح_${product?.name}_${startDate}.xlsx`);
        } catch (error) {
            console.error("Export error:", error);
            alert("حدث خطأ أثناء التصدير.");
        }
    };

    const handleInputChange = (dateKey, field, value) => {
        const newValue = value === '' ? '' : parseFloat(value);
        setCorrectionData(prev => {
            const newData = { ...prev };
            newData[dateKey] = { ...newData[dateKey], [field]: newValue };

            // Cascade recalculation for MAIN product
            const sortedDates = Object.keys(newData).sort();
            const productUnit = Number(product?.unit) || 1;
            const hasKids = childProducts.length > 0;

            let lastClose = null;
            sortedDates.forEach(dKey => {
                const d = { ...newData[dKey] };
                if (lastClose !== null) d.openingStock = lastClose;

                const open = parseFloat(d.openingStock || 0);
                const received = parseFloat(d.received || 0) * productUnit;
                const transfer = parseFloat(d.transfer || 0);
                const directTransfer = parseFloat(d.directTransfer || 0);

                if (hasKids) {
                    let totalAdd = 0, totalSales = 0, totalStaffMeal = 0, totalDamaged = 0, totalCanceled = 0, totalFree = 0;
                    childProducts.forEach(child => {
                        const cRow = childrenData[child.id]?.[dKey];
                        if (cRow) {
                            totalAdd += parseFloat(cRow.add || 0);
                            totalSales += parseFloat(cRow.sales || 0);
                            totalStaffMeal += parseFloat(cRow.staffMeal || 0);
                            totalDamaged += parseFloat(cRow.damaged || 0);
                            totalCanceled += parseFloat(cRow.canceled || 0);
                            totalFree += parseFloat(cRow.freeIncrease || 0);
                        }
                    });
                    d.closeStock = open + received + totalAdd + totalCanceled + totalFree - (totalSales + totalStaffMeal + totalDamaged + transfer + directTransfer);
                } else {
                    d.closeStock = open + received + parseFloat(d.add || 0) + parseFloat(d.canceled || 0) + parseFloat(d.freeIncrease || 0)
                        - (parseFloat(d.sales || 0) + parseFloat(d.staffMeal || 0) + parseFloat(d.damaged || 0) + transfer + directTransfer);
                }
                lastClose = d.closeStock;
                newData[dKey] = d;
            });

            // Update Deductions if field is 'sales'
            if (field === 'sales' && product?.deductions) {
                setDeductionsData(prevDeds => {
                    const nextDeds = { ...prevDeds };
                    product.deductions.forEach(ded => {
                        if (nextDeds[ded.productId] && nextDeds[ded.productId][dateKey]) {
                            const dedProd = { ...nextDeds[ded.productId] };
                            dedProd[dateKey] = { ...dedProd[dateKey], directTransfer: (newValue || 0) * (ded.amount || ded.quantity || 1) };

                            const dDates = Object.keys(dedProd).sort();
                            let dLastClose = null;
                            dDates.forEach(dk => {
                                const dr = { ...dedProd[dk] };
                                if (dLastClose !== null) dr.openingStock = dLastClose;
                                dr.closeStock = (parseFloat(dr.openingStock || 0) + parseFloat(dr.received || 0) + parseFloat(dr.add || 0) + parseFloat(dr.canceled || 0) + parseFloat(dr.freeIncrease || 0))
                                    - (parseFloat(dr.sales || 0) + parseFloat(dr.staffMeal || 0) + parseFloat(dr.damaged || 0) + parseFloat(dr.transfer || 0) + parseFloat(dr.directTransfer || 0));
                                dLastClose = dr.closeStock;
                                dedProd[dk] = dr;
                            });
                            nextDeds[ded.productId] = dedProd;
                        }
                    });
                    return nextDeds;
                });
            }
            return newData;
        });
    };

    const handleChildInputChange = (childId, dateKey, field, value) => {
        const newValue = value === '' ? '' : parseFloat(value);
        const productUnit = Number(product?.unit) || 1;

        setChildrenData(prev => {
            const next = { ...prev };
            const childDates = { ...next[childId] };
            childDates[dateKey] = { ...childDates[dateKey], [field]: newValue };

            const sorted = Object.keys(childDates).sort();
            let lastClose = null;
            sorted.forEach(dk => {
                const d = { ...childDates[dk] };
                if (lastClose !== null) d.openingStock = lastClose;
                d.closeStock = (parseFloat(d.openingStock || 0) + parseFloat(d.received || 0) + parseFloat(d.add || 0) + parseFloat(d.canceled || 0) + parseFloat(d.freeIncrease || 0))
                    - (parseFloat(d.sales || 0) + parseFloat(d.staffMeal || 0) + parseFloat(d.damaged || 0) + parseFloat(d.transfer || 0) + parseFloat(d.directTransfer || 0));
                lastClose = d.closeStock;
                childDates[dk] = d;
            });
            next[childId] = childDates;

            setCorrectionData(prevParent => {
                const newParent = { ...prevParent };
                const sortedDates = Object.keys(newParent).sort();
                let parentLastClose = null;
                sortedDates.forEach(dKey => {
                    const d = { ...newParent[dKey] };
                    if (parentLastClose !== null) d.openingStock = parentLastClose;
                    const open = parseFloat(d.openingStock || 0);
                    const received = parseFloat(d.received || 0) * productUnit;
                    const transfer = parseFloat(d.transfer || 0);
                    const directTransfer = parseFloat(d.directTransfer || 0);
                    let totalAdd = 0, totalSales = 0, totalStaffMeal = 0, totalDamaged = 0, totalCanceled = 0, totalFree = 0;
                    childProducts.forEach(child => {
                        const cDates = child.id === childId ? next[child.id] : prev[child.id];
                        const cRow = cDates?.[dKey];
                        if (cRow) {
                            totalAdd += parseFloat(cRow.add || 0);
                            totalSales += parseFloat(cRow.sales || 0);
                            totalStaffMeal += parseFloat(cRow.staffMeal || 0);
                            totalDamaged += parseFloat(cRow.damaged || 0);
                            totalCanceled += parseFloat(cRow.canceled || 0);
                            totalFree += parseFloat(cRow.freeIncrease || 0);
                        }
                    });
                    d.closeStock = open + received + totalAdd + totalCanceled + totalFree - (totalSales + totalStaffMeal + totalDamaged + transfer + directTransfer);
                    parentLastClose = d.closeStock;
                    newParent[dKey] = d;
                });
                return newParent;
            });
            return next;
        });
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const collectMonthlyRefs = (targetProductId, dataByDate) => {
                const byMonth = {};
                Object.entries(dataByDate).forEach(([dateKey, item]) => {
                    const monthStr = dateKey.substring(0, 7);
                    if (!byMonth[monthStr]) byMonth[monthStr] = {};
                    byMonth[monthStr][dateKey] = item;
                });
                return Object.entries(byMonth).map(([monthStr, monthItems]) => ({
                    ref: doc(db, "product_monthly_summaries", `${branchId}_${monthStr}_${targetProductId}`),
                    monthItems
                }));
            };

            const allMonthlyRefs = [
                ...collectMonthlyRefs(productId, correctionData),
                ...Object.entries(deductionsData).flatMap(([dedId, data]) => collectMonthlyRefs(dedId, data)),
                ...Object.entries(childrenData)
                    .filter(([, data]) => Object.keys(data).length > 0)
                    .flatMap(([childId, data]) => collectMonthlyRefs(childId, data))
            ];

            const dailyRefs = [];
            const addDailyRefs = (dataMap) => {
                Object.values(dataMap).forEach(item => {
                    if (item._docId) dailyRefs.push({ ref: doc(db, "dailyReports", item._docId), item });
                });
            };
            addDailyRefs(correctionData);
            Object.values(deductionsData).forEach(addDailyRefs);
            Object.values(childrenData).forEach(addDailyRefs);

            const sortedMainDates = Object.keys(correctionData).sort();
            const mainLastCloseStock = sortedMainDates.length ? Number(correctionData[sortedMainDates[sortedMainDates.length - 1]]?.closeStock) || 0 : 0;
            const openingStockEntries = [];
            if (sortedMainDates.length) {
                const osSnap = await getDocs(query(
                    collection(db, "openingStock"),
                    where("branchId", "==", branchId),
                    where("productId", "==", productId),
                    where("typeId", "==", typeId || product?.typeId || "5"),
                    orderBy("createdAt", "asc")
                ));
                if (!osSnap.empty) openingStockEntries.push({ ref: osSnap.docs[0].ref, newQty: mainLastCloseStock });
            }

            await runTransaction(db, async (transaction) => {
                const monthlySnaps = await Promise.all(allMonthlyRefs.map(({ ref }) => transaction.get(ref)));
                const openingStockSnaps = await Promise.all(openingStockEntries.map(({ ref }) => transaction.get(ref)));
                const dailySnaps = await Promise.all(dailyRefs.map(({ ref }) => transaction.get(ref)));

                const n = (v) => Number(v) || 0;
                const drFields = (item) => ({
                    openingStockQnt: n(item.openingStock),
                    recieved: n(item.received),
                    add: n(item.add),
                    sales: n(item.sales),
                    staffMeal: n(item.staffMeal),
                    dameged: n(item.damaged),
                    canceled: n(item.canceled),
                    transfer: n(item.transfer),
                    directTransfer: n(item.directTransfer),
                    freeIncrease: n(item.freeIncrease),
                    closeStock: n(item.closeStock),
                    updatedAt: serverTimestamp()
                });

                const buildDayData = (item) => ({
                    openingStock: n(item.openingStock),
                    received: n(item.received),
                    add: n(item.add),
                    sales: n(item.sales),
                    staffMeal: n(item.staffMeal),
                    damaged: n(item.damaged),
                    canceled: n(item.canceled),
                    transfer: n(item.transfer),
                    directTransfer: n(item.directTransfer),
                    freeIncrease: n(item.freeIncrease),
                    closeStock: n(item.closeStock)
                });

                dailyRefs.forEach(({ ref, item }, idx) => {
                    if (dailySnaps[idx].exists()) transaction.update(ref, drFields(item));
                });

                allMonthlyRefs.forEach(({ ref, monthItems }, i) => {
                    if (!monthlySnaps[i].exists()) return;
                    const existingDoc = monthlySnaps[i].data();
                    const newDocData = { ...existingDoc };
                    Object.entries(monthItems).forEach(([dateKey, item]) => {
                        const dayNum = parseInt(dateKey.split('-')[2]);
                        const dayKey = `days.${String(dayNum).padStart(2, '0')}`;
                        Object.keys(newDocData).forEach(key => {
                            if (key.startsWith('days.') && parseInt(key.split('.')[1]) === dayNum) delete newDocData[key];
                        });
                        if (newDocData.days && newDocData.days[dayNum] !== undefined) {
                            const cleanDays = { ...newDocData.days };
                            delete cleanDays[dayNum];
                            if (Object.keys(cleanDays).length) newDocData.days = cleanDays;
                            else delete newDocData.days;
                        }
                        newDocData[dayKey] = buildDayData(item);
                    });
                    transaction.set(ref, newDocData);
                });

                openingStockEntries.forEach(({ ref, newQty }, i) => {
                    if (openingStockSnaps[i].exists()) transaction.update(ref, { openingStockQnt: n(newQty), updatedAt: serverTimestamp() });
                });

                // Object.keys(correctionData).forEach(dateStr => {
                //     const dDate = new Date(dateStr);
                //     dDate.setHours(12, 0, 0, 0);
                //     transaction.set(doc(collection(db, "dailyReportsUpdates")), {
                //         branchId,
                //         date: Timestamp.fromDate(dDate),
                //         productIds: [productId, ...Object.keys(deductionsData), ...Object.keys(childrenData)],
                //         updatedAt: serverTimestamp()
                //     });
                // });

                for (const dateStr of Object.keys(correctionData)) {
                    const dDate = new Date(dateStr);
                    dDate.setHours(0, 0, 0, 0); // لضمان تطابق الوقت كما تفعل في الكود الأصلي
                    const targetTimestamp = Timestamp.fromDate(dDate);

                    // 1. البحث عن المستند الذي يطابق الفرع والتاريخ
                    const q = query(
                        collection(db, "dailyReportsUpdates"),
                        where("branchId", "==", branchId),
                        where("date", "==", targetTimestamp)
                    );

                     console.log('targetTimestamp',dDate);


                    const querySnapshot = await getDocs(q);

                    if (!querySnapshot.empty) {
                        // 2. إذا وجد المستند (تحديث)
                        const existingDoc = querySnapshot.docs[0]; // نأخذ أول مستند مطابق

                     console.log('existingDocs',querySnapshot.docs);

                     console.log('existingDoc',existingDoc);

                        transaction.update(existingDoc.ref, {
                            updatedAt: serverTimestamp()
                        });
                    } else {
                        // 3. إذا لم يجد المستند (إنشاء مستند جديد بمعرف عشوائي)
                        const newDocRef = doc(collection(db, "dailyReportsUpdates"));

                        transaction.set(newDocRef, {
                            branchId,
                            date: targetTimestamp,
                            updatedAt: serverTimestamp()
                        });
                    }
                }
            });

            alert("تم حفظ التعديلات وتحديث أرصدة كافة المنتجات المتأثرة بنجاح!");
            onClose();
        } catch (error) {
            console.error("Error saving corrections:", error);
            alert("حدث خطأ أثناء حفظ التعديلات.");
        } finally {
            setIsSaving(false);
        }
    };


    // ── Monthly Preview: per-day comparison (monthly summary ↔ correction) ──
    const PREVIEW_FIELDS = [
        { key: 'openingStock', label: 'الموجود' },
        { key: 'received', label: 'المستلم' },
        { key: 'add', label: 'الجرد' },
        { key: 'sales', label: 'مبيعات' },
        { key: 'staffMeal', label: 'وجبة موظف' },
        { key: 'damaged', label: 'تالف' },
        { key: 'canceled', label: 'ملغي' },
        { key: 'transfer', label: 'تحويل' },
        { key: 'directTransfer', label: 'ت. مباشر' },
        { key: 'freeIncrease', label: 'ز. مجانية' },
        { key: 'closeStock', label: 'المتبقي' },
    ];

    const monthlyPreviewRows = useMemo(() => {
        if (!isDataReady || Object.keys(monthlyBaseData).length === 0) return [];

        const allPids = [
            { pid: productId, name: product?.name || '-', dataByDate: correctionData },
            ...Object.entries(deductionsData).map(([pid, d]) => ({
                pid, name: allProducts?.find(p => p.id === pid)?.name || 'منتج خصم', dataByDate: d
            })),
            ...Object.entries(childrenData)
                .filter(([, d]) => Object.keys(d).length > 0)
                .map(([pid, d]) => ({
                    pid, name: allProducts?.find(p => p.id === pid)?.name || 'ابن', dataByDate: d
                }))
        ];

        const result = [];
        allPids.forEach(({ pid, name, dataByDate }) => {
            const pidBase = monthlyBaseData[pid];
            if (!pidBase) return;

            // Group corrected days by month
            const byMonth = {};
            Object.entries(dataByDate).forEach(([dateKey, item]) => {
                const m = dateKey.substring(0, 7);
                if (!byMonth[m]) byMonth[m] = [];
                byMonth[m].push({ dateKey, item });
            });

            Object.entries(byMonth).forEach(([monthStr, dayEntries]) => {
                const baseDays = pidBase[monthStr];
                if (!baseDays) return;

                // Sort days
                const dayRows = dayEntries
                    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
                    .map(({ dateKey, item }) => {
                        const dayNum = parseInt(dateKey.split('-')[2]);
                        const monthlyDay = baseDays[dayNum] || {}; // current value in monthly summary

                        // Compare field by field
                        const fieldDiffs = PREVIEW_FIELDS.map(({ key, label }) => {
                            const oldV = Number(monthlyDay[key]) || 0;
                            const newV = Number(item[key]) || 0;
                            const delta = Math.round((newV - oldV) * 100) / 100;
                            return { key, label, oldV, newV, delta, changed: Math.abs(delta) > 0.001 };
                        });

                        return { dateKey, dayNum, fieldDiffs };
                    });

                // Only include product×month if at least one day×field changed
                const hasAnyChange = dayRows.some(dr => dr.fieldDiffs.some(f => f.changed));
                if (hasAnyChange) result.push({ pid, name, monthStr, dayRows });
            });
        });
        return result;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDataReady, monthlyBaseData, correctionData, childrenData, deductionsData]);


    return (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000, backdropFilter: 'blur(5px)' }}>
            <div style={{ backgroundColor: 'white', padding: '2rem', borderRadius: '15px', width: '95%', maxWidth: '1200px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', direction: 'rtl', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '2px solid #f1f5f9', paddingBottom: '1rem' }}>
                    <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.5rem', fontWeight: '800' }}>
                        تصحيح بيانات: <span style={{ color: 'hsl(var(--color-primary))' }}>{product?.name}</span>
                    </h3>
                    <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', width: '35px', height: '35px', borderRadius: '50%', cursor: 'pointer', color: '#64748b', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '15px', marginBottom: '1.5rem', padding: '1.2rem', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold', color: '#475569' }}>تاريخ بدء التصحيح:</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            style={{ width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s' }}
                        />
                    </div>
                    <button
                        onClick={handleFetchData}
                        disabled={loading}
                        className="btn"
                        style={{ backgroundColor: 'hsl(var(--color-primary))', color: '#fff', padding: '12px 30px', borderRadius: '8px', fontWeight: 'bold', minWidth: '150px' }}
                    >
                        {loading ? 'جاري الجلب...' : 'جلب البيانات 📥'}
                    </button>
                </div>

                <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {isDataReady && (() => {
                        const allDates = Array.from(new Set([
                            ...Object.keys(correctionData),
                            ...childProducts.flatMap(c => Object.keys(childrenData[c.id] || {}))
                        ])).sort();

                        const CHILD_FIELDS = ['add', 'sales', 'staffMeal', 'damaged', 'canceled', 'freeIncrease'];
                        const CHILD_FIELD_LABELS = { add: 'الجرد', sales: 'مبيعات', staffMeal: 'وجبة موظف', damaged: 'تالف', canceled: 'مكنسل', freeIncrease: 'ز. مجانية' };

                        const hasChildren = childProducts.length > 0;
                        const rowsPerDate = hasChildren ? childProducts.length : 1;

                        const thStyle = (extra = {}) => ({ padding: '10px 8px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', fontWeight: '700', fontSize: '12px', color: '#475569', textAlign: 'center', whiteSpace: 'nowrap', ...extra });
                        const tdStyle = (extra = {}) => ({ padding: '6px', border: '1px solid #f1f5f9', textAlign: 'center', fontSize: '12px', verticalAlign: 'middle', ...extra });

                        return (
                            <div style={{ border: '2px solid #e2e8f0', borderRadius: '12px' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '1200px', }}>
                                    <thead>
                                        <tr>
                                            <th style={thStyle()}>التاريخ</th>
                                            <th style={thStyle({ backgroundColor: '#ecfdf5', color: '#15803d' })}>الأصناف</th>
                                            <th style={thStyle({ backgroundColor: '#ecfdf5', color: '#15803d', minWidth: '70px' })}>الموجود</th>
                                            <th style={thStyle({ backgroundColor: '#f0f9ff', color: '#0369a1', minWidth: '70px' })}>المستلم</th>
                                            <th style={thStyle({ backgroundColor: '#f0f9ff', color: '#0369a1', minWidth: '70px' })}>تحويل</th>
                                            <th style={thStyle({ backgroundColor: '#fff1f2', color: '#be123c', minWidth: '70px' })}>ت. مباشر</th>
                                            {CHILD_FIELDS.map(f => (
                                                <th key={f} style={thStyle({ minWidth: '70px' })}>{CHILD_FIELD_LABELS[f]}</th>
                                            ))}
                                            <th style={thStyle({ backgroundColor: '#fff7ed', color: '#c2410c', minWidth: '70px' })}>المتبقي</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allDates.map((dateKey, rowIdx) => {
                                            const parentRow = correctionData[dateKey];
                                            const bgRow = rowIdx % 2 === 0 ? '#fff' : '#fafafa';

                                            if (!hasChildren) {
                                                if (!parentRow) return null;
                                                return (
                                                    <tr key={dateKey} style={{ backgroundColor: bgRow, borderBottom: '1px solid #e2e8f0' }}>
                                                        <td style={tdStyle({ fontWeight: '600', color: '#475569', whiteSpace: 'nowrap', backgroundColor: bgRow })}>{new Date(dateKey).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' })}</td>
                                                        <td style={tdStyle({ fontWeight: 'bold', color: '#15803d', backgroundColor: '#ecfdf5' })}>{product?.name}</td>
                                                        <td style={tdStyle({ fontWeight: 'bold', backgroundColor: '#ecfdf5', color: '#15803d' })}>{parentRow.openingStock}</td>
                                                        <td style={tdStyle({ backgroundColor: '#f0f9ff' })}>
                                                            <input type="number" value={parentRow.received ?? 0} onChange={(e) => handleInputChange(dateKey, 'received', e.target.value)}
                                                                style={{ width: '65px', padding: '5px', border: '1px solid #bae6fd', borderRadius: '6px', textAlign: 'center', fontWeight: 'bold', color: '#0369a1' }} />
                                                        </td>
                                                        <td style={tdStyle({ backgroundColor: '#f0f9ff' })}>
                                                            <input type="number" value={parentRow.transfer ?? 0} onChange={(e) => handleInputChange(dateKey, 'transfer', e.target.value)}
                                                                style={{ width: '65px', padding: '5px', border: '1px solid #bae6fd', borderRadius: '6px', textAlign: 'center', color: '#0369a1' }} />
                                                        </td>
                                                        <td style={tdStyle({ backgroundColor: '#fff1f2' })}>
                                                            <input type="number" value={parentRow.directTransfer ?? 0} onChange={(e) => handleInputChange(dateKey, 'directTransfer', e.target.value)}
                                                                style={{ width: '65px', padding: '5px', border: '1px solid #fecdd3', borderRadius: '6px', textAlign: 'center', color: '#be123c' }} />
                                                        </td>
                                                        {CHILD_FIELDS.map(field => (
                                                            <td key={field} style={tdStyle()}>
                                                                <input type="number" value={parentRow[field] ?? 0} onChange={(e) => handleInputChange(dateKey, field, e.target.value)}
                                                                    style={{ width: '65px', padding: '5px', border: '1px solid #e2e8f0', borderRadius: '6px', textAlign: 'center' }} />
                                                            </td>
                                                        ))}
                                                        <td style={tdStyle({ backgroundColor: '#fff7ed', fontWeight: '800', color: 'hsl(var(--color-primary))', fontSize: '14px' })}>{parentRow.closeStock}</td>
                                                    </tr>
                                                );
                                            }

                                            // Has children: one row per child, parent cells use rowspan
                                            return childProducts.map((child, ci) => {
                                                const cRow = childrenData[child.id]?.[dateKey];
                                                const isFirst = ci === 0;
                                                return (
                                                    <tr key={`${dateKey}-${child.id}`} style={{ backgroundColor: bgRow, borderBottom: ci === childProducts.length - 1 ? '2px solid #e2e8f0' : '1px solid #f1f5f9' }}>

                                                        {/* Date — rowspan */}
                                                        {isFirst && (
                                                            <td rowSpan={childProducts.length} style={tdStyle({ fontWeight: '600', color: '#475569', whiteSpace: 'nowrap', backgroundColor: bgRow, borderBottom: '2px solid #e2e8f0' })}>
                                                                {new Date(dateKey).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' })}
                                                            </td>
                                                        )}

                                                        {/* Child name */}
                                                        <td style={tdStyle({ fontWeight: '600', color: '#334155', backgroundColor: '#f8fafc', whiteSpace: 'nowrap' })}>{child.name}</td>

                                                        {/* الموجود — rowspan, from parent */}
                                                        {isFirst && (
                                                            <td rowSpan={childProducts.length} style={tdStyle({ fontWeight: 'bold', fontSize: '15px', backgroundColor: '#ecfdf5', color: '#15803d', borderBottom: '2px solid #e2e8f0' })}>
                                                                {parentRow ? parentRow.openingStock : '—'}
                                                            </td>
                                                        )}

                                                        {/* المستلم — rowspan, from parent */}
                                                        {isFirst && (
                                                            <td rowSpan={childProducts.length} style={tdStyle({ backgroundColor: '#f0f9ff', borderBottom: '2px solid #e2e8f0' })}>
                                                                {parentRow ? (
                                                                    <input type="number" value={parentRow.received ?? 0}
                                                                        onChange={(e) => handleInputChange(dateKey, 'received', e.target.value)}
                                                                        style={{ width: '65px', padding: '5px', border: '1px solid #bae6fd', borderRadius: '6px', textAlign: 'center', fontWeight: 'bold', color: '#0369a1' }}
                                                                    />
                                                                ) : '—'}
                                                            </td>
                                                        )}

                                                        {/* تحويل — rowspan, from parent */}
                                                        {isFirst && (
                                                            <td rowSpan={childProducts.length} style={tdStyle({ backgroundColor: '#f0f9ff', borderBottom: '2px solid #e2e8f0' })}>
                                                                {parentRow ? (
                                                                    <input type="number" value={parentRow.transfer ?? 0}
                                                                        onChange={(e) => handleInputChange(dateKey, 'transfer', e.target.value)}
                                                                        style={{ width: '65px', padding: '5px', border: '1px solid #bae6fd', borderRadius: '6px', textAlign: 'center', color: '#0369a1' }}
                                                                    />
                                                                ) : '—'}
                                                            </td>
                                                        )}

                                                        {/* ت. مباشر — rowspan, from parent */}
                                                        {isFirst && (
                                                            <td rowSpan={childProducts.length} style={tdStyle({ backgroundColor: '#fff1f2', borderBottom: '2px solid #e2e8f0' })}>
                                                                {parentRow ? (
                                                                    <input type="number" value={parentRow.directTransfer ?? 0}
                                                                        onChange={(e) => handleInputChange(dateKey, 'directTransfer', e.target.value)}
                                                                        style={{ width: '65px', padding: '5px', border: '1px solid #fecdd3', borderRadius: '6px', textAlign: 'center', color: '#be123c' }}
                                                                    />
                                                                ) : '—'}
                                                            </td>
                                                        )}

                                                        {/* Child editable fields: add, sales, staffMeal, damaged, canceled, freeIncrease */}
                                                        {cRow ? CHILD_FIELDS.map(field => (
                                                            <td key={field} style={tdStyle()}>
                                                                <input type="number"
                                                                    value={cRow[field] ?? 0}
                                                                    onChange={(e) => handleChildInputChange(child.id, dateKey, field, e.target.value)}
                                                                    style={{ width: '65px', padding: '5px', border: '1px solid #e2e8f0', borderRadius: '6px', textAlign: 'center' }}
                                                                />
                                                            </td>
                                                        )) : (
                                                            CHILD_FIELDS.map(f => <td key={f} style={tdStyle({ color: '#cbd5e1' })}>—</td>)
                                                        )}

                                                        {/* المتبقي — rowspan, from parent */}
                                                        {isFirst && (
                                                            <td rowSpan={childProducts.length} style={tdStyle({ fontWeight: '800', fontSize: '15px', backgroundColor: '#fff7ed', color: 'hsl(var(--color-primary))', borderBottom: '2px solid #e2e8f0' })}>
                                                                {parentRow ? parentRow.closeStock : '—'}
                                                            </td>
                                                        )}
                                                    </tr>
                                                );
                                            });
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })()}




                    {Object.keys(deductionsData).length > 0 && (
                        <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', backgroundColor: '#fff' }}>
                            <div style={{ padding: '10px 15px', backgroundColor: '#fff1f2', fontWeight: 'bold', color: '#be123c', borderBottom: '1px solid #e2e8f0' }}>
                                منتجات تتأثر بخصم المبيعات للمنتج الرئيسي (Deductions)
                            </div>
                            <div style={{ padding: '1rem', overflowX: 'auto' }}>
                                {Object.keys(deductionsData).map(dedId => (
                                    <div key={dedId} style={{ marginBottom: '1.5rem', border: '1px solid #f1f5f9', borderRadius: '8px' }}>
                                        <div style={{ padding: '8px 12px', backgroundColor: '#f8fafc', fontWeight: 'bold', fontSize: '14px', borderBottom: '1px solid #f1f5f9' }}>
                                            {deductionsData[dedId][Object.keys(deductionsData[dedId])[0]]?._name || 'منتج خصم'}
                                        </div>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'center' }}>
                                            <thead style={{ backgroundColor: '#fcfdfe' }}>
                                                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                                                    <th style={{ padding: '10px', borderLeft: '1px solid #f1f5f9' }}>التاريخ</th>
                                                    <th style={{ padding: '10px', borderLeft: '1px solid #f1f5f9', backgroundColor: '#ecfdf5' }}>الموجودة</th>
                                                    <th style={{ padding: '10px', borderLeft: '1px solid #f1f5f9' }}>مستلم</th>
                                                    <th style={{ padding: '10px', borderLeft: '1px solid #f1f5f9' }}>الجرد</th>
                                                    <th style={{ padding: '10px', borderLeft: '1px solid #f1f5f9' }}>مبيعات</th>
                                                    <th style={{ padding: '10px', borderLeft: '1px solid #f1f5f9' }}>وجبة موظف</th>
                                                    <th style={{ padding: '10px', borderLeft: '1px solid #f1f5f9' }}>تالف</th>
                                                    <th style={{ padding: '10px', borderLeft: '1px solid #f1f5f9' }}>مكنسل</th>
                                                    <th style={{ padding: '10px', borderLeft: '1px solid #f1f5f9' }}>تحويل</th>
                                                    <th style={{ padding: '10px', borderLeft: '1px solid #f1f5f9', backgroundColor: '#fff1f2' }}>ت. مباشر</th>
                                                    <th style={{ padding: '10px', borderLeft: '1px solid #f1f5f9' }}>ز. مجانية</th>
                                                    <th style={{ padding: '10px', backgroundColor: '#fff7ed', fontWeight: 'bold' }}>المتبقي</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {Object.keys(deductionsData[dedId]).sort().map(dk => (
                                                    <tr key={dk} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                        <td style={{ padding: '6px', color: '#64748b' }}>{dk}</td>
                                                        <td style={{ padding: '4px', backgroundColor: '#f8fafc' }}>
                                                            <div style={{ padding: '8px', fontSize: '13px', fontWeight: 'bold', color: '#1e293b' }}>
                                                                {deductionsData[dedId][dk].openingStock}
                                                            </div>
                                                        </td>
                                                        {['received', 'add', 'sales', 'staffMeal', 'damaged', 'canceled', 'transfer', 'directTransfer', 'freeIncrease'].map(field => (
                                                            <td key={field} style={{ padding: '4px', backgroundColor: field === 'directTransfer' ? '#fff1f2' : 'transparent' }}>
                                                                <div style={{
                                                                    padding: '8px',
                                                                    fontSize: '12px',
                                                                    color: field === 'directTransfer' ? '#be123c' : '#475569',
                                                                    fontWeight: field === 'directTransfer' ? '800' : 'normal'
                                                                }}>
                                                                    {deductionsData[dedId][dk][field]}
                                                                </div>
                                                            </td>
                                                        ))}
                                                        <td style={{ padding: '6px', backgroundColor: '#fff7ed', fontWeight: 'bold', color: 'hsl(var(--color-primary))', fontSize: '14px' }}>
                                                            {deductionsData[dedId][dk].closeStock}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>





                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '15px', paddingTop: '1.5rem', borderTop: '2px solid #f1f5f9' }}>
                    <button
                        onClick={onClose}
                        className="btn"
                        style={{ backgroundColor: '#fff', color: '#64748b', border: '1px solid #cbd5e1', padding: '12px 35px', borderRadius: '8px' }}
                    >
                        إلغاء
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !isDataReady}
                        className="btn"
                        style={{
                            backgroundColor: isDataReady ? '#10b981' : '#94a3b8',
                            color: '#fff',
                            padding: '12px 50px',
                            borderRadius: '8px',
                            fontWeight: 'bold',
                            boxShadow: isDataReady ? '0 10px 15px -3px rgba(16, 185, 129, 0.3)' : 'none'
                        }}
                    >
                        {isSaving ? 'جاري الحفظ...' : 'حفظ كافة التعديلات ✅'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ProductCorrectionModal;
