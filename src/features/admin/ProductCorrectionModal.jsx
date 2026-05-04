import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, getDoc, doc, runTransaction, Timestamp, serverTimestamp, orderBy } from "firebase/firestore";
import { db } from '../../config/firebase';

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

    const handleDeductionInputChange = (dedId, dateKey, field, value) => {
        const newValue = value === '' ? '' : parseFloat(value);
        setDeductionsData(prev => {
            const nextDeds = { ...prev };
            const prodDeds = { ...nextDeds[dedId] };
            prodDeds[dateKey] = { ...prodDeds[dateKey], [field]: newValue };

            // Recalculate cascade for this specific deduction product
            const sortedDates = Object.keys(prodDeds).sort();
            let lastClose = null;
            sortedDates.forEach(dk => {
                if (lastClose !== null) {
                    prodDeds[dk].openingStock = lastClose;
                }
                const d = prodDeds[dk];
                const open = parseFloat(d.openingStock || 0);
                const received = parseFloat(d.received || 0);
                const add = parseFloat(d.add || 0);
                const sales = parseFloat(d.sales || 0);
                const staffMeal = parseFloat(d.staffMeal || 0);
                const damaged = parseFloat(d.damaged || 0);
                const canceled = parseFloat(d.canceled || 0);
                const transfer = parseFloat(d.transfer || 0);
                const direct = parseFloat(d.directTransfer || 0);
                const free = parseFloat(d.freeIncrease || 0);

                d.closeStock = open + received + add + canceled + free - (sales + staffMeal + damaged + transfer + direct);
                lastClose = d.closeStock;
            });

            nextDeds[dedId] = prodDeds;
            return nextDeds;
        });
    };

    const handleFetchData = async () => {
        if (!productId || !branchId || !startDate) return;
        setLoading(true);
        try {
            const startStr = startDate; // YYYY-MM-DD
            const today = new Date();
            const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

            // Widen range by 1 day on each side to account for UTC shifts
            const wideStart = new Date(new Date(startStr).getTime() - 24 * 60 * 60 * 1000);
            const wideEnd = new Date(new Date(todayStr).getTime() + 24 * 60 * 60 * 1000);

            const startTs = Timestamp.fromDate(wideStart);
            const endTs = Timestamp.fromDate(wideEnd);

            console.log(`[Correction] Fetching with Wide Range: ${wideStart.toISOString()} to ${wideEnd.toISOString()}`);
            console.log(`[Correction] Params: Branch=${branchId}, Product=${productId}`);

            const q = query(
                collection(db, "dailyReports"),
                where("branchId", "==", branchId),
                where("productId", "==", productId),
                where("date", ">=", startTs),
                where("date", "<=", endTs),
                orderBy("date", "asc")
            );

            const snap = await getDocs(q);
            const rangeData = {};

            snap.docs.forEach(docSnap => {
                const dayData = docSnap.data();
                const dDate = dayData.date.toDate();
                const dateKey = dDate.getFullYear() + '-' + String(dDate.getMonth() + 1).padStart(2, '0') + '-' + String(dDate.getDate()).padStart(2, '0');

                if (dateKey >= startStr && dateKey <= todayStr) {
                    const monthStr = dateKey.substring(0, 7);
                    rangeData[dateKey] = {
                        day: dDate.getDate(),
                        monthStr: monthStr,
                        fullDate: dateKey,
                        received: dayData.recieved ?? dayData.received ?? 0,
                        add: dayData.add ?? 0,
                        sales: dayData.sales ?? 0,
                        staffMeal: dayData.staffMeal ?? 0,
                        damaged: dayData.dameged ?? dayData.damaged ?? 0,
                        canceled: dayData.canceled ?? 0,
                        transfer: dayData.transfer ?? 0,
                        directTransfer: dayData.directTransfer ?? 0,
                        freeIncrease: dayData.freeIncrease ?? 0,
                        openingStock: dayData.openingStockQnt ?? dayData.openingStock ?? 0,
                        closeStock: dayData.closeStock ?? 0,
                        _docId: docSnap.id,
                        _isDailyReport: true
                    };
                }
            });

            // Fetch Deductions Data
            const newDeductionsData = {};
            if (product?.deductions && product.deductions.length > 0) {
                for (const ded of product.deductions) {
                    const dedQ = query(
                        collection(db, "dailyReports"),
                        where("branchId", "==", branchId),
                        where("productId", "==", ded.productId),
                        where("date", ">=", startTs),
                        where("date", "<=", endTs),
                        orderBy("date", "asc")
                    );
                    const dedSnap = await getDocs(dedQ);
                    const dedRangeData = {};
                    dedSnap.docs.forEach(docSnap => {
                        const dayData = docSnap.data();
                        const dDate = dayData.date.toDate();
                        const dateKey = dDate.getFullYear() + '-' + String(dDate.getMonth() + 1).padStart(2, '0') + '-' + String(dDate.getDate()).padStart(2, '0');

                        const dedProductInfo = allProducts?.find(p => p.id === ded.productId);
                        const mainDayData = rangeData[dateKey];
                        const mainSales = mainDayData?.sales || 0;
                        // Use 'amount' as it matches the database field for deductions
                        const autoDirectTransfer = mainSales * (ded.amount || ded.quantity || 1);

                        if (dateKey >= startStr && dateKey <= todayStr) {
                            dedRangeData[dateKey] = {
                                _docId: docSnap.id,
                                openingStock: dayData.openingStockQnt ?? dayData.openingStock ?? 0,
                                received: dayData.recieved ?? dayData.received ?? 0,
                                add: dayData.add ?? 0,
                                sales: dayData.sales ?? 0,
                                staffMeal: dayData.staffMeal ?? 0,
                                damaged: dayData.dameged ?? dayData.damaged ?? 0,
                                canceled: dayData.canceled ?? 0,
                                transfer: dayData.transfer ?? 0,
                                directTransfer: autoDirectTransfer, // Force calculation on load
                                freeIncrease: dayData.freeIncrease ?? 0,
                                closeStock: dayData.closeStock ?? 0,
                                _name: dedProductInfo?.name || ded.productName || 'منتج خصم'
                            };
                        }
                    });

                    // After setting all days, recalculate deduction balances
                    const dedDates = Object.keys(dedRangeData).sort();
                    let dLastClose = null;
                    dedDates.forEach(dk => {
                        if (dLastClose !== null) dedRangeData[dk].openingStock = dLastClose;
                        const dr = dedRangeData[dk];
                        dr.closeStock = (parseFloat(dr.openingStock || 0) + parseFloat(dr.received || 0) + parseFloat(dr.add || 0) + parseFloat(dr.canceled || 0) + parseFloat(dr.freeIncrease || 0)) -
                            (parseFloat(dr.sales || 0) + parseFloat(dr.staffMeal || 0) + parseFloat(dr.damaged || 0) + parseFloat(dr.transfer || 0) + parseFloat(dr.directTransfer || 0));
                        dLastClose = dr.closeStock;
                    });

                    newDeductionsData[ded.productId] = dedRangeData;
                }
            }

            // Fetch Children Data
            const newChildrenData = {};
            if (childProducts.length > 0) {
                for (const child of childProducts) {
                    const childQ = query(
                        collection(db, "dailyReports"),
                        where("branchId", "==", branchId),
                        where("productId", "==", child.id),
                        where("date", ">=", startTs),
                        where("date", "<=", endTs),
                        orderBy("date", "asc")
                    );
                    const childSnap = await getDocs(childQ);
                    const childRangeData = {};
                    childSnap.docs.forEach(docSnap => {
                        const dayData = docSnap.data();
                        const dDate = dayData.date.toDate();
                        const dateKey = dDate.getFullYear() + '-' + String(dDate.getMonth() + 1).padStart(2, '0') + '-' + String(dDate.getDate()).padStart(2, '0');
                        if (dateKey >= startStr && dateKey <= todayStr) {
                            childRangeData[dateKey] = {
                                _docId: docSnap.id,
                                _name: child.name,
                                openingStock: dayData.openingStockQnt ?? dayData.openingStock ?? 0,
                                received: dayData.recieved ?? dayData.received ?? 0,
                                add: dayData.add ?? 0,
                                sales: dayData.sales ?? 0,
                                staffMeal: dayData.staffMeal ?? 0,
                                damaged: dayData.dameged ?? dayData.damaged ?? 0,
                                canceled: dayData.canceled ?? 0,
                                transfer: dayData.transfer ?? 0,
                                directTransfer: dayData.directTransfer ?? 0,
                                freeIncrease: dayData.freeIncrease ?? 0,
                                closeStock: dayData.closeStock ?? 0,
                            };
                        }
                    });
                    // Cascade recalculate
                    const cDates = Object.keys(childRangeData).sort();
                    let cLastClose = null;
                    cDates.forEach(dk => {
                        if (cLastClose !== null) childRangeData[dk].openingStock = cLastClose;
                        const cr = childRangeData[dk];
                        cr.closeStock = (parseFloat(cr.openingStock || 0) + parseFloat(cr.received || 0) + parseFloat(cr.add || 0) + parseFloat(cr.canceled || 0) + parseFloat(cr.freeIncrease || 0))
                            - (parseFloat(cr.sales || 0) + parseFloat(cr.staffMeal || 0) + parseFloat(cr.damaged || 0) + parseFloat(cr.transfer || 0) + parseFloat(cr.directTransfer || 0));
                        cLastClose = cr.closeStock;
                    });
                    newChildrenData[child.id] = childRangeData;
                }
            }

            setCorrectionData(rangeData);
            setDeductionsData(newDeductionsData);
            setChildrenData(newChildrenData);
            // Snapshot initial values for preview comparison
            setInitialSnapshot({
                correction: JSON.parse(JSON.stringify(rangeData)),
                children: JSON.parse(JSON.stringify(newChildrenData)),
                deductions: JSON.parse(JSON.stringify(newDeductionsData))
            });
            const hasData = Object.keys(rangeData).length > 0 || Object.values(newChildrenData).some(c => Object.keys(c).length > 0);
            setIsDataReady(hasData);
            if (!hasData) {
                alert("لم يتم العثور على أي تقارير يومية في هذه الفترة لهذا المنتج.");
                return;
            }
            // Fetch monthly base data for preview
            const allProductsToPreview = [
                { pid: productId, dataByDate: rangeData },
                ...Object.entries(newDeductionsData).map(([pid, d]) => ({ pid, dataByDate: d })),
                ...Object.entries(newChildrenData).filter(([, d]) => Object.keys(d).length > 0).map(([pid, d]) => ({ pid, dataByDate: d }))
            ];
            const newMonthlyBase = {};
            for (const { pid, dataByDate } of allProductsToPreview) {
                newMonthlyBase[pid] = {};
                const months = [...new Set(Object.keys(dataByDate).map(d => d.substring(0, 7)))];
                for (const monthStr of months) {
                    const snap = await getDoc(doc(db, "product_monthly_summaries", `${branchId}_${monthStr}_${pid}`));
                    if (!snap.exists()) continue;
                    const data = snap.data();
                    const days = {};
                    // Support both nested ({ days: { '12': {...} } }) and flat ({ 'days.12': {...} }) formats
                    if (data.days && typeof data.days === 'object') {
                        Object.entries(data.days).forEach(([k, v]) => { days[parseInt(k)] = v; });
                    }
                    Object.keys(data).forEach(key => {
                        if (key.startsWith('days.')) {
                            const dayNum = parseInt(key.split('.')[1]);
                            if (!days[dayNum]) days[dayNum] = data[key]; // flat format fallback
                        }
                    });
                    newMonthlyBase[pid][monthStr] = days;
                }
            }
            setMonthlyBaseData(newMonthlyBase);
        } catch (error) {
            console.error("Error fetching correction data:", error);
            alert("حدث خطأ أثناء جلب البيانات. تأكد من وجود اتصال وتوفر التقارير.");
        } finally {
            setLoading(false);
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
                const d = { ...newData[dKey] }; // ← new copy per row
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
                newData[dKey] = d; // ← store the new copy
            });

            // Update Deductions if field is 'sales'
            if (field === 'sales' && product?.deductions) {
                setDeductionsData(prevDeds => {
                    const nextDeds = { ...prevDeds };
                    product.deductions.forEach(ded => {
                        if (nextDeds[ded.productId] && nextDeds[ded.productId][dateKey]) {
                            const dedProd = { ...nextDeds[ded.productId] };
                            dedProd[dateKey] = { ...dedProd[dateKey], directTransfer: (newValue || 0) * (ded.amount || ded.quantity || 1) };

                            // Cascade for deduction product
                            const dDates = Object.keys(dedProd).sort();
                            let dLastClose = null;
                            dDates.forEach(dk => {
                                const dr = { ...dedProd[dk] }; // ← new copy per row
                                if (dLastClose !== null) dr.openingStock = dLastClose;
                                dr.closeStock = (parseFloat(dr.openingStock || 0) + parseFloat(dr.received || 0) + parseFloat(dr.add || 0) + parseFloat(dr.canceled || 0) + parseFloat(dr.freeIncrease || 0))
                                    - (parseFloat(dr.sales || 0) + parseFloat(dr.staffMeal || 0) + parseFloat(dr.damaged || 0) + parseFloat(dr.transfer || 0) + parseFloat(dr.directTransfer || 0));
                                dLastClose = dr.closeStock;
                                dedProd[dk] = dr; // ← store the new copy
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

            // Cascade child
            const sorted = Object.keys(childDates).sort();
            let lastClose = null;
            sorted.forEach(dk => {
                const d = { ...childDates[dk] }; // ← new copy per row
                if (lastClose !== null) d.openingStock = lastClose;
                d.closeStock = (parseFloat(d.openingStock || 0) + parseFloat(d.received || 0) + parseFloat(d.add || 0) + parseFloat(d.canceled || 0) + parseFloat(d.freeIncrease || 0))
                    - (parseFloat(d.sales || 0) + parseFloat(d.staffMeal || 0) + parseFloat(d.damaged || 0) + parseFloat(d.transfer || 0) + parseFloat(d.directTransfer || 0));
                lastClose = d.closeStock;
                childDates[dk] = d; // ← store the new copy
            });
            next[childId] = childDates;

            // Recalculate parent closeStock using updated children
            setCorrectionData(prevParent => {
                const newParent = { ...prevParent };
                const sortedDates = Object.keys(newParent).sort();
                let parentLastClose = null;
                sortedDates.forEach(dKey => {
                    const d = { ...newParent[dKey] }; // ← new copy per row
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
                    newParent[dKey] = d; // ← store the new copy
                });
                return newParent;
            });

            return next;
        });
    };




    const handleSave = async () => {
        setIsSaving(true);
        try {
            // ── Phase 1: Build monthly refs directly from doc ID pattern: branchId_month_productId ──
            const collectMonthlyRefs = (targetProductId, dataByDate) => {
                const byMonth = {};
                Object.entries(dataByDate).forEach(([dateKey, item]) => {
                    const monthStr = dateKey.substring(0, 7); // YYYY-MM
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

            // ── Phase 1c: Collect dailyReports refs ──
            const dailyRefs = []; // [{ ref, data }]
            const addDailyRefs = (dataMap) => {
                Object.values(dataMap).forEach(item => {
                    if (item._docId) dailyRefs.push({ ref: doc(db, "dailyReports", item._docId), item });
                });
            };
            addDailyRefs(correctionData);
            Object.values(deductionsData).forEach(addDailyRefs);
            Object.values(childrenData).forEach(addDailyRefs);

            // ── Phase 1b: Pre-query openingStock ref for main product only ──
            const sortedMainDates = Object.keys(correctionData).sort();
            const mainLastCloseStock = sortedMainDates.length
                ? Number(correctionData[sortedMainDates[sortedMainDates.length - 1]]?.closeStock) || 0
                : 0;
            const openingStockEntries = []; // max 1 entry
            if (sortedMainDates.length) {
                const osSnap = await getDocs(query(
                    collection(db, "openingStock"),
                    where("branchId", "==", branchId),
                    where("productId", "==", productId),
                    where("typeId", "==", typeId || product?.typeId || "5"),
                    orderBy("createdAt", "asc")
                ));
                if (!osSnap.empty)
                    openingStockEntries.push({ ref: osSnap.docs[0].ref, newQty: mainLastCloseStock });
            }

            // ── Phase 2: runTransaction — reads first, then writes ──
            await runTransaction(db, async (transaction) => {

                // READ all monthly docs + openingStock docs + dailyReport docs to lock them
                const monthlySnaps = await Promise.all(
                    allMonthlyRefs.map(({ ref }) => transaction.get(ref))
                );
                const openingStockSnaps = await Promise.all(
                    openingStockEntries.map(({ ref }) => transaction.get(ref))
                );
                const dailySnaps = await Promise.all(
                    dailyRefs.map(({ ref }) => transaction.get(ref))
                );

                // Helper: daily report fields
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

                // Helper: build a single day's data object
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

                // WRITE 1, 2, 3 — dailyReports (Only update if doc exists in DB)
                dailyRefs.forEach(({ ref, item }, idx) => {
                    if (dailySnaps[idx].exists()) {
                        transaction.update(ref, drFields(item));
                    } else {
                        console.warn(`Daily report doc ${ref.id} not found in Firestore.`);
                    }
                });

                // WRITE 4 — product_monthly_summaries
                // Use transaction.set (not update) to preserve flat "days.N" field format.
                // Merge corrected days into the full existing document data.
                allMonthlyRefs.forEach(({ ref, monthItems }, i) => {


                    if (!monthlySnaps[i].exists()) return;
                    const existingDoc = monthlySnaps[i].data();
                    // Copy all existing fields (preserves branchId, productId, month, other days)
                    const newDocData = { ...existingDoc };
                    // Overwrite only the corrected days using flat key format
                    Object.entries(monthItems).forEach(([dateKey, item]) => {
                        const dayNum = parseInt(dateKey.split('-')[2]);
                        const dayKey = `days.${String(dayNum).padStart(2, '0')}`; // e.g. days.01
                        // Delete ALL existing variants of this day (padded and unpadded)
                        Object.keys(newDocData).forEach(key => {
                            if (key.startsWith('days.') && parseInt(key.split('.')[1]) === dayNum) {
                                delete newDocData[key];
                            }
                        });
                        // Remove nested days entry if exists
                        if (newDocData.days && newDocData.days[dayNum] !== undefined) {
                            const cleanDays = { ...newDocData.days };
                            delete cleanDays[dayNum];
                            if (Object.keys(cleanDays).length) newDocData.days = cleanDays;
                            else delete newDocData.days;
                        }
                        // Write with zero-padded format
                        newDocData[dayKey] = buildDayData(item);
                    });

                    transaction.set(ref, newDocData);
                });

                // WRITE 5 — openingStock (last day closeStock → new opening balance)
                openingStockEntries.forEach(({ ref, newQty }, i) => {
                    if (openingStockSnaps[i].exists())
                        transaction.update(ref, {
                            openingStockQnt: Number(newQty) || 0,
                            updatedAt: serverTimestamp()
                        });
                });

                // WRITE 6 — Triggers for each corrected date
                const uniqueDates = Object.keys(correctionData);
                uniqueDates.forEach(dateStr => {
                    const dDate = new Date(dateStr);
                    dDate.setHours(12, 0, 0, 0); // Normalize to midday to match system timestamps
                    
                    transaction.set(doc(collection(db, "dailyReportsUpdates")), {
                        branchId,
                        date: Timestamp.fromDate(dDate),
                        productIds: [productId, ...Object.keys(deductionsData), ...Object.keys(childrenData)],
                        updatedAt: serverTimestamp()
                    });
                });
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
                            <div style={{ overflowX: 'auto', border: '2px solid #e2e8f0', borderRadius: '12px' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
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


                {/* ── Monthly Summary Preview (per-day) ── */}
                {monthlyPreviewRows.length > 0 && (
                    <div style={{ marginTop: '1.5rem', border: '1.5px solid #6366f1', borderRadius: '12px', overflow: 'hidden', flexShrink: 0 }}>
                        <div
                            onClick={() => setShowMonthlyPreview(v => !v)}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', backgroundColor: '#eef2ff', cursor: 'pointer', userSelect: 'none' }}
                        >
                            <span style={{ fontWeight: '700', color: '#4338ca', fontSize: '13px' }}>
                                📊 معاينة التأثير على التقارير الشهرية — مقارنة يوم بيوم ({monthlyPreviewRows.length} منتج متأثر)
                            </span>
                            <span style={{ color: '#6366f1', fontSize: '16px' }}>{showMonthlyPreview ? '▲' : '▼'}</span>
                        </div>
                        {showMonthlyPreview && (
                            <div style={{ maxHeight: '280px', overflowY: 'auto', padding: '10px', backgroundColor: '#fafafe', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {monthlyPreviewRows.map(({ pid, name, monthStr, dayRows }) => (
                                    <div key={`${pid}_${monthStr}`} style={{ border: '1px solid #e0e7ff', borderRadius: '8px', overflow: 'hidden' }}>
                                        {/* Product + Month Header */}
                                        <div style={{ padding: '6px 12px', backgroundColor: '#e0e7ff', display: 'flex', gap: '10px', alignItems: 'center' }}>
                                            <span style={{ fontWeight: '700', color: '#3730a3', fontSize: '13px' }}>{name}</span>
                                            <span style={{ fontSize: '11px', color: '#6366f1', backgroundColor: '#c7d2fe', padding: '1px 7px', borderRadius: '99px' }}>{monthStr}</span>
                                        </div>
                                        {/* Per-Day Table */}
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'center' }}>
                                                <thead>
                                                    <tr style={{ backgroundColor: '#f5f3ff' }}>
                                                        <th style={{ padding: '6px 10px', textAlign: 'right', color: '#4338ca', borderBottom: '1px solid #e0e7ff', whiteSpace: 'nowrap', position: 'sticky', right: 0, backgroundColor: '#f5f3ff', zIndex: 1 }}>التاريخ</th>
                                                        {PREVIEW_FIELDS.map(({ key, label }) => (
                                                            <th key={key} style={{ padding: '6px 8px', color: '#475569', borderBottom: '1px solid #e0e7ff', borderRight: '1px solid #f1f5f9', whiteSpace: 'nowrap', minWidth: '65px' }}>
                                                                {label}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {dayRows.map(({ dateKey, fieldDiffs }) => (
                                                        <tr key={dateKey} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                            <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: '600', color: '#334155', whiteSpace: 'nowrap', position: 'sticky', right: 0, backgroundColor: '#fafafe', borderRight: '1px solid #e0e7ff', zIndex: 1 }}>
                                                                {dateKey.split('-').slice(1).reverse().join('/')}
                                                            </td>
                                                            {fieldDiffs.map(({ key, newV, delta, changed }) => (
                                                                <td key={key} style={{ padding: '5px 6px', borderRight: '1px solid #f1f5f9', backgroundColor: changed ? (delta > 0 ? '#f0fdf4' : '#fff1f2') : 'transparent', textAlign: 'center' }}>
                                                                    <span style={{
                                                                        fontWeight: changed ? '700' : '400',
                                                                        color: changed ? (delta > 0 ? '#15803d' : '#dc2626') : '#94a3b8',
                                                                        fontSize: '12px'
                                                                    }}>
                                                                        {newV}
                                                                    </span>
                                                                    {changed && (
                                                                        <span style={{ display: 'block', fontSize: '9px', color: delta > 0 ? '#15803d' : '#dc2626' }}>
                                                                            {delta > 0 ? '+' : ''}{delta}
                                                                        </span>
                                                                    )}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>

                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}


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
