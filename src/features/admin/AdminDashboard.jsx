import React, { useState, useEffect } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';
import { collection, query, where, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, setDoc, orderBy, Timestamp } from "firebase/firestore";
import { db } from '../../config/firebase';

// Helper: Calculate Remaining Stock
// Helper: Calculate Remaining Stock
// Helper: Calculate Remaining Stock
const calculateRemaining = (parentReport, childReports = [], productId, openingStockData = [], branchId, unit = 1) => {
    const val = (v) => Number(v || 0);

    // 1. Opening Stock Logic (Priority: OpeningStock Collection > Daily Report)
    // const openingItem = openingStockData?.find(o => o.productId === productId && o.branchId === branchId);
    let openingStock = val(parentReport?.openingStockQnt);;
    console.log('openingStockP', parentReport);
    console.log('openingStockC', childReports);



    // if (openingItem) {
    //     openingStock = val(openingItem.openingStockQnt);
    // } else {
    //     openingStock = val(parentReport?.openingStockQnt);
    // }

    // Parent-specific fields
    const recieved = val(parentReport?.recieved);
    const transfer = val(parentReport?.transfer);

    // 2. Aggregated fields (from children if exist, else parent)
    const sumField = (field) => {
        if (childReports && childReports.length > 0) {
            return childReports.reduce((total, child) => total + val(child?.[field]), 0);
        }
        return val(parentReport?.[field]);
    };

    const add = sumField('add'); // 'add' might not be in UI but requested in calc
    const sales = sumField('sales');
    const staffMeal = sumField('staffMeal');
    const dameged = sumField('dameged');

    // 3. Calculation
    // Total = Op + (Rec * Unit) + Add - Sales - Staff - Transfer - Damaged
    const total = openingStock + (recieved * unit) + add - sales - staffMeal - transfer - dameged;

    return isNaN(total) ? '-' : total;
};

const AdminDashboard = () => {
    // Filters
    const [selectedCity, setSelectedCity] = useState('ryad'); // Default to ryad
    const [selectedBranch, setSelectedBranch] = useState('');
    const [selectedOrderType, setSelectedOrderType] = useState('');
    const [openingStockData, setOpeningStockData] = useState([]);

    // Opening Stock Correction Modal State
    const [isStockModalOpen, setIsStockModalOpen] = useState(false);
    const [editingStockItem, setEditingStockItem] = useState(null);
    const [newStockValue, setNewStockValue] = useState('');
    const [settlementHistory, setSettlementHistory] = useState([]); // For Auto-Settle Verification

    const [reportDates, setReportDates] = useState([]); // Daily Report Dates
    const [selectedReportDate, setSelectedReportDate] = useState('');
    const [dailyReportData, setDailyReportData] = useState([]); // { productId: { ... } }

    // Data
    const [orderTypes, setOrderTypes] = useState([]);
    const [branches, setBranches] = useState([]); // Dynamic
    const [products, setProducts] = useState([]);
    const [loadingProducts, setLoadingProducts] = useState(false);

    // Modal / Form
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null); // null = adding new
    const [formData, setFormData] = useState({
        name: '',
        unit: '',
        unitF: '',
        parentProduct: '',
        sortOrder: 0,
        isSales: false,
        deductFromProduct: '',
        deductAmount: 1,
        targetBranch: 'current' // 'current' or 'both'
    });

    // ... (unchanged code)

    // Handlers
    // Handlers
    // handleOpenModal moved below


    // UI States
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [notification, setNotification] = useState(null); // { type: 'success'|'error', message: '' }

    const showNotification = (type, message) => {
        setNotification({ type, message });
        setTimeout(() => setNotification(null), 3000); // Auto hide after 3 seconds
    };

    // 1. Fetch Order Types & Branches on Mount
    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch Types
                const typesSnapshot = await getDocs(collection(db, "types"));
                const typesList = typesSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));

                const monthlyId = "WbAP06wLDRvZFTYUtkjU";
                if (!typesList.some(t => t.id === monthlyId)) {
                    typesList.push({ id: monthlyId, name: 'الجرد الشهري' });
                }
                setOrderTypes(typesList);

                // Fetch Branches (Cache First)
                const cachedBranches = localStorage.getItem('saba_admin_branches');
                let branchList = [];

                if (cachedBranches) {
                    try {
                        branchList = JSON.parse(cachedBranches);
                        setBranches(branchList);
                    } catch (e) { console.error("Cache error", e); }
                }

                // If local cache missing or empty, fetch server
                if (branchList.length === 0) {
                    const branchesSnap = await getDocs(collection(db, "branches"));
                    branchList = branchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                    // Fallback if truly empty on server
                    if (branchList.length === 0) {
                        branchList = [
                            { id: 'ryad', name: 'الرياض (Riyadh)' },
                            { id: 'other', name: 'خارج الرياض (Outside Riyadh)' }
                        ];
                    }
                    setBranches(branchList);
                    localStorage.setItem('saba_admin_branches', JSON.stringify(branchList));
                }

                // Set default city if needed (Already Ryad)
                // if(branchList.length > 0 && !selectedCity) {
                //      setSelectedCity(branchList[0].id);
                // }

            } catch (error) {
                console.error("Error fetching initial data:", error);
            }
        };
        fetchData();
    }, []);

    // 2. Fetch Products (Standard)
    useEffect(() => {
        const fetchProducts = async () => {
            if (!selectedOrderType) {
                setProducts([]);
                return;
            }

            const cacheKey = `products_${selectedCity}_${selectedOrderType}`;
            const cachedDataString = localStorage.getItem(cacheKey);
            let cachedData = null;

            if (cachedDataString) {
                try {
                    cachedData = JSON.parse(cachedDataString);
                    if (cachedData && Array.isArray(cachedData.items)) {
                        setProducts(cachedData.items);
                    }
                } catch (e) {
                    console.error("Cache parse error", e);
                }
            }

            if (!cachedData) setLoadingProducts(true);

            try {
                // Check ProductUpdates from Server
                const updateDocRef = doc(db, "productUpdates", `${selectedCity}_${selectedOrderType}`);
                const updateSnap = await getDoc(updateDocRef);

                const serverValues = updateSnap.exists() ? updateSnap.data() : null;
                const serverLastUpdate = serverValues?.updatedAt?.toMillis() || 0;
                const localLastSync = cachedData?.lastSync || 0;

                if (!cachedData || serverLastUpdate > localLastSync) {
                    if (!cachedData) setLoadingProducts(true);

                    const productsRef = collection(db, "products");
                    const q = query(
                        productsRef,
                        where("typeId", "==", selectedOrderType),
                        where("city", "==", selectedCity)
                    );

                    const querySnapshot = await getDocs(q);
                    const items = querySnapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));

                    items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

                    setProducts(items);

                    localStorage.setItem(cacheKey, JSON.stringify({
                        items: items,
                        lastSync: Date.now()
                    }));
                }

            } catch (error) {
                console.error("Error fetching admin products:", error);
            } finally {
                setLoadingProducts(false);
            }
        };

        fetchProducts();
    }, [selectedCity, selectedOrderType]);

    // 3. Fetch Daily Report Dates (Preserving Timestamp)
    useEffect(() => {
        const fetchReportDates = async () => {
            const dailyType = orderTypes.find(t => t.name.includes('يومي') || t.name.includes('Daily'));
            const isDaily = dailyType && selectedOrderType === dailyType.id;

            if (selectedBranch && isDaily) {
                const cacheKey = `reportDates_${selectedBranch}_${selectedOrderType}`;
                const cachedDates = localStorage.getItem(cacheKey);

                const sanitizeDate = (dateVal) => {
                    if (dateVal && typeof dateVal === 'object' && dateVal.seconds) {
                        // Convert to Local Date String (YYYY-MM-DD) to avoid UTC shift (e.g., Feb 1 00:00 +3 -> Jan 31 21:00 UTC)
                        const d = new Date(dateVal.seconds * 1000);
                        return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                    }
                    return dateVal;
                };

                let useCached = false;
                if (cachedDates) {
                    try {
                        const parsed = JSON.parse(cachedDates);
                        const fixedCache = parsed.map(d => ({
                            ...d,
                            date: sanitizeDate(d.date),
                            originalDate: d.originalDate || d.date // Keep if exists
                        }));
                        fixedCache.sort((a, b) => new Date(b.date) - new Date(a.date));
                        setReportDates(fixedCache);
                        useCached = true;
                    } catch (e) {
                        console.error("Cache corrupted, fetching fresh", e);
                        localStorage.removeItem(cacheKey);
                    }
                }

                // 2. Always fetch fresh data (Stale-While-Revalidate pattern)
                // We do NOT block fetching even if cache exists, to ensure we get new dates.
                try {
                    const q = query(collection(db, "dailyReportsDates"),
                        where("branchId", "==", selectedBranch),
                        where("typeId", "==", selectedOrderType)
                    );
                    const snap = await getDocs(q);
                    const dates = snap.docs.map(d => {
                        const data = d.data();
                        return {
                            id: d.id, ...data,
                            date: sanitizeDate(data.date),
                            originalDate: data.date
                        };
                    });
                    console.log('dates', dates);

                    dates.sort((a, b) => new Date(b.date) - new Date(a.date));

                    setReportDates(dates);
                    localStorage.setItem(cacheKey, JSON.stringify(dates));
                } catch (error) {
                    console.error("Error fetching dates:", error);
                }

                /* Old "Block if Cached" Logic Removed */
                /* if (!useCached) { ... } */
            } else {
                setReportDates([]);
                setSelectedReportDate('');
            }
        };

        fetchReportDates();
    }, [selectedBranch, selectedOrderType, orderTypes]); // Added relevant deps

    // 4. Fetch Opening Stock (User Requested Logic)
    useEffect(() => {
        const fetchOpeningStock = async () => {
            if (!selectedBranch || !selectedOrderType) return;

            try {
                const q = query(
                    collection(db, "openingStock"), // Assuming collection name
                    where("branchId", "==", selectedBranch),
                    where("typeId", "==", selectedOrderType),
                    orderBy("createdAt", "asc")
                );

                const snapshot = await getDocs(q);
                const data = snapshot.docs.map(doc => ({
                    id: doc.id,
                    productId: doc.data()['productId'],
                    branchId: doc.data()['branchId'],
                    openingStockQnt: doc.data()['openingStockQnt'],
                }));

                console.log('openStock', data);
                setOpeningStockData(data);
            } catch (error) {
                console.error("Error fetching opening stock:", error);
            }
        };

        fetchOpeningStock();
    }, [selectedBranch, selectedOrderType]);
    // 5. Fetch Daily Report Data (The actual numbers)
    useEffect(() => {
        const fetchDailyData = async () => {
            if (!selectedReportDate || !selectedBranch) {
                setDailyReportData([]);
                return;
            }

            // Start/End are derived directly from selectedReportDate (which is now a date string)
            const targetDateStr = selectedReportDate;

            setLoadingProducts(true);
            try {
                // We use dailyReportsUpdates to check sync?
                // For now, let's just fetch the data for the specific Date + Branch
                // We need to match the 'date' field in dailyReports collection.
                // If originalDate is a Timestamp object (rehydrated from JSON it might be different, but let's try)

                // Problem: JSON.stringify(timestamp) -> {seconds, ...} or string? 
                // In localStorage it becomes an object.
                // We construct a query.

                const reportsRef = collection(db, "dailyReports");
                // Construct query: Branch + Date
                // Note: accurate timestamp matching might be hard if seconds differ. 
                // But usually these are generated together.
                // Alternative: Filter via dateId if supported? 
                // User didn't give dateId in sample. 
                // Let's assume we can filter by the exact timestamp stored in reportDates.

                // Re-hydrate timestamp if needed for Firestore query
                // or just query by branch and filter in memory (safest for small datasets per branch)
                // Define start and end of the selected day
                console.log('selectedReportDate', selectedReportDate);

                // Using Local Dates to match the Local String from sanitizeDate
                const start = new Date(`${selectedReportDate}T00:00:00`);
                const end = new Date(`${selectedReportDate}T23:59:59.999`);

                console.log("Fetching Daily Data Query:", {
                    branchId: selectedBranch,
                    typeId: selectedOrderType,
                    start: start,
                    end: end
                });

                const q = query(
                    reportsRef,
                    where("branchId", "==", selectedBranch),
                    where("typeId", "==", selectedOrderType),
                    where("date", ">=", Timestamp.fromDate(start)),
                    where("date", "<=", Timestamp.fromDate(end))
                );

                // Ideally add: where("date", "==", dateObj.originalDate)
                // But let's fetch branch/type and filter by date match in JS to be safe against Timestamp drift

                const snap = await getDocs(q);
                // Filter
                const items = snap.docs
                    .map(d => d.data())
                    .filter(item => {
                        // item.date is Timestamp
                        if (item.date && item.date.seconds) {
                            const d = new Date(item.date.seconds * 1000);
                            const itemDateStr = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                            return itemDateStr === targetDateStr;
                        }
                        return false;
                    });

                setDailyReportData(items);

            } catch (err) {
                console.error("Error fetching daily report details", err);
            } finally {
                setLoadingProducts(false);
            }
        };

        // Only run if we have a selected date
        if (selectedReportDate) fetchDailyData();
        else setDailyReportData([]);

    }, [selectedReportDate, selectedBranch, selectedOrderType, reportDates]);


    // Handlers
    const handleOpenModal = (product = null) => {
        if (product) {
            setEditingProduct(product);
            setFormData({
                name: product.name || '',
                unit: product.unit || '',
                unitF: product.unitF || '',
                parentProduct: product.parentProduct || '',
                sortOrder: product.sortOrder || 0,
                isSales: product.isSales || false,
                deductFromProduct: product.deductFromProduct || '',
                deductAmount: product.deductAmount || 1,
                targetBranch: 'current'
            });
        } else {
            setEditingProduct(null);
            setFormData({
                name: '',
                unit: '',
                unitF: '',
                parentProduct: '',
                sortOrder: 0,
                isSales: false,
                deductFromProduct: '',
                deductAmount: 1,
                targetBranch: 'current'
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingProduct(null);
    };

    // Helper: Trigger update for sync
    const triggerUpdate = async (city, typeId) => {
        try {
            // Use deterministic ID to avoid query sorting issues and ensure single source of truth
            const docId = `${city}_${typeId}`;
            await setDoc(doc(db, "productUpdates", docId), {
                city,
                typeId,
                updatedAt: serverTimestamp()
            });
            console.log(`Triggered update for ${docId}`);
        } catch (error) {
            console.error("Error triggering update:", error);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();

        if (!selectedOrderType) {
            showNotification('error', "الرجاء اختيار نوع الطلبية أولاً");
            return;
        }

        setIsSubmitting(true);
        try {
            // Base Data
            const baseData = {
                name: formData.name,
                unit: formData.unit,
                unitF: formData.unitF,
                typeId: selectedOrderType,
                parentProduct: formData.parentProduct || null,
                sortOrder: Number(formData.sortOrder) || 0,
                isSales: formData.isSales || false,
                deductFromProduct: formData.deductFromProduct || null,
                deductAmount: formData.deductFromProduct ? (Number(formData.deductAmount) || 1) : 1,
                updatedAt: serverTimestamp()
            };

            // Helper to update local state and cache
            const updateLocalData = (newList) => {
                const sortedList = newList.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
                setProducts(sortedList);

                // Update Cache immediately
                const cacheKey = `products_${selectedCity}_${selectedOrderType}`;
                localStorage.setItem(cacheKey, JSON.stringify({
                    items: sortedList,
                    lastSync: Date.now()
                }));
            };

            if (editingProduct) {
                // UPDATE (Single product only)
                const docRef = doc(db, "products", editingProduct.id);
                // Ensure we don't accidentally change city during edit logic unless intended (here we stick to current)
                const updateData = { ...baseData, city: selectedCity };

                await updateDoc(docRef, updateData);

                // Update local state & Cache
                const newList = products.map(p => p.id === editingProduct.id ? { ...p, ...updateData } : p);
                updateLocalData(newList);

                showNotification('success', "تم تحديث المنتج بنجاح");
                await triggerUpdate(selectedCity, selectedOrderType);

            } else {
                // CREATE (Check for Both Branches)
                if (formData.targetBranch === 'both') {
                    const citiesToCreate = ['ryad', 'other'];

                    for (const city of citiesToCreate) {
                        const newDocData = { ...baseData, city, createdAt: serverTimestamp() };
                        await addDoc(collection(db, "products"), newDocData);
                        await triggerUpdate(city, selectedOrderType);

                        // If we just added to the OTHER city, we should technically clear its cache so it refetches next time
                        if (city !== selectedCity) {
                            const otherKey = `products_${city}_${selectedOrderType}`;
                            localStorage.removeItem(otherKey); // Force refetch for other branch
                        }
                    }

                    // For Current Branch
                    const matchesCurrent = { ...baseData, city: selectedCity, createdAt: new Date() }; // Mock obj for UI
                    const newList = [...products, matchesCurrent];
                    updateLocalData(newList);

                    showNotification('success', "تم إضافة المنتج للفرعين بنجاح");

                } else {
                    // CREATE (Single Branch)
                    const newDocData = { ...baseData, city: selectedCity, createdAt: serverTimestamp() };
                    const docRef = await addDoc(collection(db, "products"), newDocData);

                    const newList = [...products, { id: docRef.id, ...newDocData }];
                    updateLocalData(newList);

                    await triggerUpdate(selectedCity, selectedOrderType);
                    showNotification('success', "تم إضافة المنتج بنجاح");
                }
            }

            handleCloseModal();
        } catch (error) {
            console.error("Error saving product:", error);
            showNotification('error', "حدث خطأ أثناء الحفظ");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (productId) => {
        if (!window.confirm("هل أنت متأكد من حذف هذا المنتج؟")) return;

        setIsSubmitting(true);
        try {
            // We need the product details to know which city/type to trigger
            const productToDelete = products.find(p => p.id === productId);

            await deleteDoc(doc(db, "products", productId));

            // Update Local & Cache
            const newList = products.filter(p => p.id !== productId);
            setProducts(newList);
            const cacheKey = `products_${selectedCity}_${selectedOrderType}`;
            localStorage.setItem(cacheKey, JSON.stringify({
                items: newList,
                lastSync: Date.now()
            }));

            if (productToDelete) {
                await triggerUpdate(productToDelete.city, productToDelete.typeId);
            }
            showNotification('success', "تم حذف المنتج بنجاح");
        } catch (error) {
            console.error("Error deleting product:", error);
            showNotification('error', "حدث خطأ أثناء الحذف");
        } finally {
            setIsSubmitting(false);
        }
    };

    // --- Opening Stock Adjustment Handlers ---
    const handleOpenStockModal = (item, currentVal) => {
        setEditingStockItem(item);
        setNewStockValue(currentVal);
        setSettlementHistory([]); // Reset history
        setIsStockModalOpen(true);
    };

    const handleAutoSettle = async () => {
        if (!editingStockItem || !selectedBranch || !selectedOrderType || !selectedReportDate) return;

        setIsSubmitting(true);
        try {
            // Fetch History for Parent AND Children
            const childProducts = products.filter(p => p.parentProduct === editingStockItem.id);
            const targetIds = [editingStockItem.id, ...childProducts.map(p => p.id)];

            // Parallel Fetch to avoid "IN" query limits or index issues
            const snapshots = await Promise.all(
                targetIds.map(id => {
                    const q = query(
                        collection(db, "dailyReports"),
                        where("branchId", "==", selectedBranch),
                        where("typeId", "==", selectedOrderType),
                        where("productId", "==", id)
                    );
                    return getDocs(q);
                })
            );

            // Flatten and Group by Date
            const rawDocs = snapshots.flatMap(s => s.docs.map(d => d.data()));

            // Helper to get reliable date string key
            const getDateKey = (seconds) => {
                if (!seconds) return 'unknown';
                const d = new Date(seconds * 1000);
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };

            const groupedByDate = {};
            rawDocs.forEach(d => {
                if (!d.date || !d.date.seconds) return;
                const key = getDateKey(d.date.seconds);
                if (!groupedByDate[key]) {
                    groupedByDate[key] = { date: d.date, parent: null, children: [] };
                }

                if (d.productId === editingStockItem.id) {
                    groupedByDate[key].parent = d;
                } else {
                    const childName = childProducts.find(p => p.id === d.productId)?.name || 'فرعي';
                    groupedByDate[key].children.push({ ...d, productName: childName });
                }
            });

            // Convert to Array and Sort
            const history = Object.values(groupedByDate).sort((a, b) => {
                return (a.date?.seconds || 0) - (b.date?.seconds || 0);
            });

            setSettlementHistory(history); // Store { date, parent, children[] }

            // Calculate Cumulative/Closing Flow
            const val = (v) => Number(v || 0);
            const unit = Number(editingStockItem.unit) || 1;
            let runningBalance = 0;

            const calculatedHistory = history.map((dayArgs, idx) => {
                const { parent, children } = dayArgs;

                const sum = (field) => {
                    let s = parent ? val(parent[field]) : 0;
                    if (children && children.length > 0) {
                        s += children.reduce((acc, c) => acc + val(c[field]), 0);
                    }
                    return s;
                };

                const add = sum('add');

                // Re-calculate sales sum using same logic for consistency
                let sales = parent ? val(parent.sales) : 0;
                if (children && children.length > 0) {
                    sales += children.reduce((acc, c) => acc + val(c.sales), 0);
                }

                const dameged = sum('dameged');
                const staffMeal = sum('staffMeal');

                // Opening Stock Logic (In Pieces):
                let effectiveOpening = 0;

                if (idx === 0) {
                    // First Record: Trust DB Opening
                    const parentOpening = parent ? val(parent.openingStockQnt) : 0;
                    const childOpening = children ? children.reduce((acc, c) => acc + val(c.openingStockQnt), 0) : 0;
                    // Adjusted: Parent (Raw) + Child (Raw)
                    effectiveOpening = parentOpening + childOpening;
                    runningBalance = effectiveOpening;
                } else {
                    // Subsequent: Use Previous Closing
                    effectiveOpening = runningBalance;
                }

                // Transactions (In Pieces)
                const parentRec = parent ? val(parent.recieved) : 0;
                const childRec = children ? children.reduce((acc, c) => acc + val(c.recieved), 0) : 0;
                const totalRec = (parentRec * unit) + childRec;

                const parentTrans = parent ? val(parent.transfer) : 0;
                const childTrans = children ? children.reduce((acc, c) => acc + val(c.transfer), 0) : 0;
                const totalTrans = (parentTrans * unit) + childTrans;

                // Net Change = Rec + Add - Sales - Out ...
                const netChange = totalRec + add - sales - totalTrans - dameged - staffMeal;

                const closing = effectiveOpening + netChange;

                // Update Running Balance (Pieces)
                runningBalance = closing;

                return {
                    ...dayArgs,
                    calculatedOpening: effectiveOpening,
                    calculatedClosing: closing,
                    breakdowns: {
                        add,
                        sales,
                        dameged,
                        staffMeal,
                        recieved: totalRec,
                        transfer: totalTrans
                    }
                };
            });

            setSettlementHistory(calculatedHistory);

            const finalStock = calculatedHistory.length > 0 ? calculatedHistory[calculatedHistory.length - 1].calculatedClosing : 0;

            console.log(`Auto Settle: Calculated ${finalStock} (Pieces) from ${history.length} days.`);
            setNewStockValue(finalStock);
            showNotification('success', `تم الحساب وتصحيح التراكمي لـ ${history.length} سجلات`);

        } catch (error) {
            console.error("Auto Settle Error:", error);
            showNotification('error', "فشل الحساب التلقائي");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSaveStock = async () => {
        if (!editingStockItem || !selectedBranch || !selectedOrderType) return;

        setIsSubmitting(true);
        try {
            const val = Number(newStockValue);

            // Check if document exists
            const q = query(
                collection(db, "openingStock"),
                where("branchId", "==", selectedBranch),
                where("typeId", "==", selectedOrderType),
                where("productId", "==", editingStockItem.id)
            );
            const snapshot = await getDocs(q);

            if (!snapshot.empty) {
                // UPDATE
                const docId = snapshot.docs[0].id;
                await updateDoc(doc(db, "openingStock", docId), {
                    openingStockQnt: val,
                    updatedAt: serverTimestamp()
                });

                // Update Local State
                setOpeningStockData(prev => prev.map(o =>
                    o.id === docId ? { ...o, openingStockQnt: val } : o
                ));
            } else {
                // CREATE
                const newDoc = {
                    branchId: selectedBranch,
                    typeId: selectedOrderType,
                    productId: editingStockItem.id,
                    openingStockQnt: val,
                    createdAt: serverTimestamp()
                };
                const ref = await addDoc(collection(db, "openingStock"), newDoc);

                // Update Local State
                setOpeningStockData(prev => [...prev, { id: ref.id, ...newDoc }]);
            }

            showNotification('success', "تم تعديل الرصيد الافتتاحي بنجاح");
            setIsStockModalOpen(false);
            setEditingStockItem(null);
            setNewStockValue('');
            setSettlementHistory([]);

        } catch (error) {
            console.error("Error saving opening stock:", error);
            showNotification('error', "حدث خطأ أثناء الحفظ");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <DashboardLayout title="إدارة المنتجات" role="admin">

            {/* Filters Section */}
            <div className="card" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>

                    {/* City Select */}
                    {/* City Select */}
                    <div className="input-group" style={{ marginBottom: 0 }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>المدينة</label>
                        <select
                            className="input-field"
                            value={selectedCity}
                            onChange={(e) => {
                                setSelectedCity(e.target.value);
                                setSelectedBranch(''); // Reset branch on city change
                            }}
                        >
                            <option value="ryad">الرياض (Riyadh)</option>
                            <option value="other">خارج الرياض (Outside Riyadh)</option>
                        </select>
                    </div>

                    {/* Branch Select (Dependent on City) */}
                    <div className="input-group" style={{ marginBottom: 0 }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>الفرع</label>
                        <select
                            className="input-field"
                            value={selectedBranch}
                            onChange={(e) => setSelectedBranch(e.target.value)}
                        >
                            <option value="">-- اختر الفرع --</option>
                            {branches
                                .filter(b => b.city === selectedCity || (!b.city && selectedCity === 'ryad')) // Default to ryad if city missing, or match exact
                                .map(branch => (
                                    <option key={branch.id} value={branch.id}>
                                        {branch.name || branch.id}
                                    </option>
                                ))
                            }
                        </select>
                    </div>

                    {/* Order Type Select */}
                    <div className="input-group" style={{ marginBottom: 0 }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>نوع الطلبية</label>
                        <select
                            className="input-field"
                            value={selectedOrderType}
                            onChange={(e) => setSelectedOrderType(e.target.value)}
                        >
                            <option value="">-- اختر النوع --</option>
                            {orderTypes.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Daily Report Date Select (Dynamic) */}
                    {reportDates.length > 0 && (
                        <div className="input-group" style={{ marginBottom: 0 }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>تاريخ التقرير</label>
                            <select
                                className="input-field"
                                value={selectedReportDate}
                                onChange={(e) => {
                                    console.log('selectedTypeId', selectedOrderType);
                                    console.log('selectedBranchId', selectedBranch);


                                    setSelectedReportDate(e.target.value)
                                }}
                            >
                                <option value="">-- اختر التاريخ --</option>
                                {reportDates.map(report => (
                                    <option key={report.id} value={report.date}>
                                        {report.date}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
            </div>

            {/* Products Action Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.5rem', color: 'hsl(var(--color-primary))', fontWeight: '700' }}>
                    قائمة المنتجات ({products.length})
                </h2>
                <button
                    className="btn btn-primary"
                    onClick={() => handleOpenModal()}
                    disabled={!selectedOrderType}
                    title={!selectedOrderType ? "اختر نوع الطلبية أولاً" : ""}
                >
                    + إضافة منتج جديد
                </button>
            </div>

            {/* Products Table */}
            <div className="card">
                {loadingProducts ? (
                    <p style={{ textAlign: 'center', padding: '2rem' }}>جاري التحميل...</p>
                ) : !selectedOrderType ? (
                    <p style={{ textAlign: 'center', padding: '2rem', color: 'hsl(var(--color-text-muted))' }}>الرجاء اختيار نوع الطلبية لعرض المنتجات</p>
                ) : products.length === 0 ? (
                    <p style={{ textAlign: 'center', padding: '2rem', color: 'hsl(var(--color-text-muted))' }}>لا توجد منتجات مضافة لهذا التصنيف في هذه المدينة.</p>
                ) : (
                    <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
                        {/* Daily Report View */}
                        {orderTypes.find(t => t.id === selectedOrderType)?.name.includes('يومي') ? (
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px', fontSize: '13px' }}>
                                <thead style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                                    <tr className="f-h" style={{ backgroundColor: '#f8f9fa' }}>
                                        <th style={{ position: 'sticky', left: 0, zIndex: 11, backgroundColor: '#f8f9fa', padding: '10px', borderBottom: '2px solid #dee2e6' }}>الاصناف</th>
                                        <th style={{ width: '60px', padding: '10px', borderBottom: '2px solid #dee2e6' }}>افتتاحية الرصيد في هذا التاريخ</th>
                                        <th style={{ width: '60px', padding: '10px', borderBottom: '2px solid #dee2e6', color: '#64748b', fontSize: '11px' }}>الموجودة فعلياً</th>
                                        <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>المستلم</th>
                                        <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>الجرد</th>
                                        <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>مبيعات</th>
                                        <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>وجبة موظف</th>
                                        <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>تحويل %</th>
                                        <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>التالف</th>
                                        <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>المتبقي</th>
                                        <th style={{ width: '80px', padding: '10px', borderBottom: '2px solid #dee2e6' }}>إجراءات</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        // 1. Group Data
                                        const roots = products.filter(p => !p.parentProduct);
                                        const getChildren = (parentId) => products.filter(p => p.parentProduct === parentId);

                                        return roots.map((item, index) => {
                                            const children = getChildren(item.id);
                                            const hasChildren = children.length > 0;

                                            // The list to render data rows for: either [item] (if no children) or [children...]
                                            // As per user design, if has children, the rows are the children. The parent is just a side label.
                                            const dataRows = hasChildren ? children : [item];

                                            return (
                                                <tr key={item.id} style={{ borderBottom: '1px solid #dee2e6', backgroundColor: index % 2 === 0 ? '#fff' : '#f9fafb' }}>
                                                    {/* Sticky Name Column */}
                                                    <td style={{
                                                        position: 'sticky', left: 0, padding: 0,
                                                        backgroundColor: index % 2 === 0 ? '#fff' : '#f9fafb',
                                                        borderRight: '1px solid #dee2e6',
                                                        zIndex: 5
                                                    }}>
                                                        {hasChildren ? (
                                                            <div style={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
                                                                {/* Parent Label Vertical */}
                                                                <div style={{
                                                                    writingMode: 'vertical-rl',
                                                                    transform: 'rotate(180deg)',
                                                                    fontWeight: 'bold',
                                                                    fontSize: '13px',
                                                                    padding: '8px',
                                                                    textAlign: 'center',
                                                                    borderLeft: '1px solid #ccc', // RTL flip: borderRight in user code might mean left in LTR, or right in RTL. Assuming RTL layout in app? 
                                                                    // User style: border-right. If dir=rtl, this is towards center. 
                                                                    // React defaults LTR usually unless set. I'll stick to user logic but use borderRight.
                                                                    borderLeft: '1px solid #ccc', // Adjusted for visual separation
                                                                    backgroundColor: '#f1f1f1',
                                                                    minWidth: '30px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    cursor: 'pointer'
                                                                }} onClick={() => {
                                                                    const report = dailyReportData.find(d => d.productId === item.id);
                                                                    console.log('Raw Report (Parent):', report);
                                                                }}>
                                                                    {item.name}
                                                                    <div style={{ marginTop: '5px', display: 'flex', gap: '4px', fontSize: '10px' }}>
                                                                        <span title="تعديل الأب" onClick={(e) => { e.stopPropagation(); handleOpenModal(item); }}>✏️</span>
                                                                        <span title="حذف الأب" onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}>❌</span>
                                                                    </div>
                                                                </div>
                                                                {/* Children Names Stack */}
                                                                <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, fontSize: '12px' }}>
                                                                    {children.map((sub, idx) => (
                                                                        <div key={sub.id} style={{
                                                                            padding: '6px 8px',
                                                                            borderBottom: idx === children.length - 1 ? 'none' : '1px solid #eee',
                                                                            height: '40px', // Fixed height for alignment
                                                                            display: 'flex', alignItems: 'center',
                                                                            cursor: 'pointer'
                                                                        }} onClick={() => {
                                                                            const report = dailyReportData.find(d => d.productId === sub.id);
                                                                            console.log('Raw Report (Child):', report);
                                                                        }}>
                                                                            {sub.name}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div style={{ fontWeight: 'bold', fontSize: '13px', padding: '12px 8px', cursor: 'pointer' }}
                                                                onClick={() => {
                                                                    const report = dailyReportData.find(d => d.productId === item.id);
                                                                    const op = openingStockData.find(d => d.productId === item.id);

                                                                    console.log('Raw Report (Item):', report);
                                                                    console.log('Raw OpenningStocj (Item):', op);

                                                                }}>
                                                                {item.name}
                                                            </div>
                                                        )}
                                                    </td>

                                                    {/* Common Data Columns Function */}
                                                    {['openingStockQnt', 'actualOpening', 'recieved', 'closeStock', 'sales', 'staffMeal', 'transfer', 'dameged', 'remaining'].map(field => {
                                                        const isParentField = ['openingStockQnt', 'actualOpening', 'recieved', 'transfer', 'remaining'].includes(field);

                                                        // Case 1: Has Children & Field is Parent-Only -> Render Single Value for Parent
                                                        if (hasChildren && isParentField) {
                                                            const parentReport = dailyReportData.find(d => d.productId === item.id) || {};

                                                            let displayValue = '-';
                                                            if (field === 'remaining') {
                                                                const childReports = children.map(c => dailyReportData.find(d => d.productId === c.id));
                                                                displayValue = calculateRemaining(parentReport, childReports, item.id, openingStockData, selectedBranch);
                                                            } else if (field === 'actualOpening') {
                                                                const oItem = openingStockData?.find(o => o.productId === item.id && o.branchId === selectedBranch);
                                                                displayValue = oItem ? oItem.openingStockQnt : '-';
                                                            } else {
                                                                displayValue = parentReport[field] !== undefined ? parentReport[field] : '';
                                                            }

                                                            return (
                                                                <td key={field} style={{ padding: 0, verticalAlign: 'middle', borderLeft: '1px solid #eee', textAlign: 'center' }}>
                                                                    <div style={{
                                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                        height: '100%', minHeight: children.length * 40 + 'px',
                                                                        fontWeight: 'bold', fontSize: '14px'
                                                                    }}>
                                                                        {displayValue}
                                                                        {field === 'actualOpening' && (
                                                                            <span
                                                                                style={{ cursor: 'pointer', marginLeft: '5px', color: '#64748b' }}
                                                                                title="تعديل الرصيد الافتتاحي"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    handleOpenStockModal(item, displayValue);
                                                                                }}
                                                                            >
                                                                                ✏️
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            );
                                                        }

                                                        // Case 2: Standard Child/Item Rendering
                                                        return (
                                                            <td key={field} style={{ padding: 0, verticalAlign: 'top', borderLeft: '1px solid #eee' }}>
                                                                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                                                    {dataRows.map((rowItem, idx) => {
                                                                        const report = dailyReportData.find(d => d.productId === rowItem.id) || {};

                                                                        // Value Logic
                                                                        let displayValue = '-';
                                                                        if (field === 'remaining') {
                                                                            displayValue = calculateRemaining(report, [], rowItem.id, openingStockData, selectedBranch);
                                                                        } else if (field === 'actualOpening') {
                                                                            const oItem = openingStockData?.find(o => o.productId === rowItem.id && o.branchId === selectedBranch);
                                                                            displayValue = oItem ? oItem.openingStockQnt : '-';
                                                                        } else {
                                                                            displayValue = report[field] !== undefined ? report[field] : '';
                                                                        }

                                                                        return (
                                                                            <div key={rowItem.id} style={{
                                                                                padding: '6px 8px',
                                                                                borderBottom: idx === dataRows.length - 1 ? 'none' : '1px solid #eee',
                                                                                height: hasChildren ? '40px' : 'auto',
                                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                fontWeight: field === 'closeStock' ? 'bold' : 'normal',
                                                                                color: field === 'sales' ? '#22c55e' : 'inherit'
                                                                            }}>
                                                                                {displayValue}
                                                                                {field === 'actualOpening' && (
                                                                                    <span
                                                                                        style={{ cursor: 'pointer', marginLeft: '5px', color: '#64748b', fontSize: '10px' }}
                                                                                        title="تعديل الرصيد الافتتاحي"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleOpenStockModal(rowItem, displayValue);
                                                                                        }}
                                                                                    >
                                                                                        ✏️
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </td>
                                                        );
                                                    })}

                                                    {/* Actions Column */}
                                                    <td style={{ padding: 0, verticalAlign: 'top', borderLeft: '1px solid #eee' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                                            {dataRows.map((rowItem, idx) => (
                                                                <div key={rowItem.id} style={{
                                                                    padding: '6px 8px',
                                                                    borderBottom: idx === dataRows.length - 1 ? 'none' : '1px solid #eee',
                                                                    height: hasChildren ? '40px' : 'auto',
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                                                                }}>
                                                                    <button
                                                                        onClick={() => handleOpenModal(rowItem)}
                                                                        style={{
                                                                            background: 'none', border: 'none', cursor: 'pointer',
                                                                            fontSize: '1.2em', padding: '0 4px'
                                                                        }}
                                                                        title="تعديل"
                                                                    >
                                                                        ✏️
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDelete(rowItem.id)}
                                                                        style={{
                                                                            background: 'none', border: 'none', cursor: 'pointer',
                                                                            fontSize: '1em', padding: '0 4px', opacity: 0.7
                                                                        }}
                                                                        title="حذف"
                                                                    >
                                                                        ❌
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        ) : (
                            // Standard Table
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f8fafc', color: 'hsl(var(--color-text-muted))', textAlign: 'right' }}>
                                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>الاسم</th>
                                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>المنتج الأب</th>
                                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>الترتيب</th>
                                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>الوحدة</th>
                                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>تاريخ الإنشاء</th>
                                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>آخر تعديل</th>
                                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>إجراءات</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {products.map((product) => {
                                        const parentName = product.parentProduct
                                            ? products.find(p => p.id === product.parentProduct)?.name || 'غير موجود'
                                            : '-';

                                        return (
                                            <tr key={product.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '0.75rem', fontWeight: '500' }}>{product.name}</td>
                                                <td style={{ padding: '0.75rem', color: 'hsl(var(--color-primary))', fontSize: '0.9rem' }}>{parentName}</td>
                                                <td style={{ padding: '0.75rem' }}>{product.sortOrder || 0}</td>
                                                <td style={{ padding: '0.75rem' }}>{product.unitF || product.unit || '-'}</td>
                                                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#64748b' }}>
                                                    {product.createdAt?.seconds ? new Date(product.createdAt.seconds * 1000).toLocaleDateString('en-GB') : '-'}
                                                </td>
                                                <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#64748b' }}>
                                                    {product.updatedAt?.seconds ? new Date(product.updatedAt.seconds * 1000).toLocaleDateString('en-GB') : '-'}
                                                </td>
                                                <td style={{ padding: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                                                    <button
                                                        onClick={() => handleOpenModal(product)}
                                                        style={{
                                                            background: 'none', border: '1px solid #e2e8f0',
                                                            padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer',
                                                            color: 'hsl(var(--color-primary))'
                                                        }}
                                                    >
                                                        تعديل
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(product.id)}
                                                        style={{
                                                            background: 'none', border: '1px solid #fee2e2',
                                                            padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer',
                                                            color: '#ef4444', backgroundColor: '#fef2f2'
                                                        }}
                                                    >
                                                        حذف
                                                    </button>
                                                </td>
                                            </tr>
                                        );

                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>

            {/* Add/Edit Modal */}
            {isModalOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', zIndex: 1000,
                    padding: '1rem', backdropFilter: 'blur(3px)'
                }}>
                    <div className="card" style={{ width: '100%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto', padding: '0', borderRadius: '12px' }}>
                        <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, color: 'hsl(var(--color-primary))', fontSize: '1.25rem' }}>
                                {editingProduct ? 'تعديل بيانات المنتج' : 'إضافة منتج جديد'}
                            </h3>
                            <button onClick={handleCloseModal} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}>&times;</button>
                        </div>

                        <form onSubmit={handleSave} style={{ padding: '2rem' }}>

                            {/* Grid Layout */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>

                                {/* Section 1: Basic Info */}
                                <div>
                                    <h4 style={{ marginBottom: '1rem', color: '#334155', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem' }}>البيانات الأساسية</h4>

                                    <div className="input-group">
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>اسم المنتج <span style={{ color: 'red' }}>*</span></label>
                                        <input
                                            type="text"
                                            className="input-field"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            required
                                            placeholder="أدخل اسم المنتج"
                                            style={{ borderColor: formData.name ? '#e2e8f0' : '#fca5a5' }}
                                        />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div className="input-group">
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>الوحدة الأساسية</label>
                                            <input
                                                type="text"
                                                className="input-field"
                                                value={formData.unit}
                                                onChange={e => setFormData({ ...formData, unit: e.target.value })}
                                                placeholder="مثال: حبة"
                                            />
                                        </div>
                                        <div className="input-group">
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>الوحدة الفرعية</label>
                                            <input
                                                type="text"
                                                className="input-field"
                                                value={formData.unitF}
                                                onChange={e => setFormData({ ...formData, unitF: e.target.value })}
                                                placeholder="مثال: كرتون"
                                            />
                                        </div>
                                    </div>

                                    <div className="input-group">
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>ترتيب العرض</label>
                                        <input
                                            type="number"
                                            className="input-field"
                                            value={formData.sortOrder}
                                            onChange={e => setFormData({ ...formData, sortOrder: e.target.value })}
                                            placeholder="0"
                                        />
                                        <small style={{ color: 'hsl(var(--color-text-muted))', fontSize: '0.8rem' }}>الأرقام الأقل تظهر أولاً في القائمة</small>
                                    </div>

                                    <div className="input-group" style={{ marginTop: '1.5rem' }}>
                                        <label style={{
                                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                                            padding: '0.75rem', border: '1px solid #cbd5e1',
                                            borderRadius: '8px', cursor: 'pointer',
                                            backgroundColor: formData.isSales ? '#eff6ff' : 'transparent',
                                            borderColor: formData.isSales ? '#3b82f6' : '#cbd5e1',
                                            transition: 'all 0.2s'
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={formData.isSales}
                                                onChange={e => setFormData({ ...formData, isSales: e.target.checked })}
                                                style={{ width: '1.25rem', height: '1.25rem', accentColor: 'hsl(var(--color-primary))' }}
                                            />
                                            <div>
                                                <div style={{ fontWeight: '600', color: '#1e293b' }}>بيع مباشر فقط ؟</div>
                                                {/* <div style={{ fontSize: '0.8rem', color: '#64748b' }}>يظهر في قائمة المبيعات للعملاء</div> */}
                                            </div>
                                        </label>
                                    </div>
                                </div>

                                {/* Section 2: Relations & Advanced */}
                                <div>
                                    <h4 style={{ marginBottom: '1rem', color: '#334155', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem' }}>العلاقات والمخزون</h4>

                                    <div className="input-group">
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>المنتج الأب (التصنيف الرئيسي)</label>
                                        <select
                                            className="input-field"
                                            value={formData.parentProduct || ''}
                                            onChange={e => setFormData({ ...formData, parentProduct: e.target.value })}
                                            style={{ backgroundColor: '#fff' }}
                                        >
                                            <option value="">-- منتج مستقل (بدون أب) --</option>
                                            {products
                                                .filter(p => p.id !== (editingProduct?.id))
                                                .map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))
                                            }
                                        </select>
                                    </div>

                                    <div className="input-group">
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>خصم المخزون من</label>
                                        <select
                                            className="input-field"
                                            value={formData.deductFromProduct || ''}
                                            onChange={e => setFormData({ ...formData, deductFromProduct: e.target.value })}
                                            style={{ backgroundColor: formData.deductFromProduct ? '#fff7ed' : '#fff' }}
                                        >
                                            <option value="">-- يخصم من نفس المنتج --</option>
                                            {products
                                                .filter(p => p.id !== (editingProduct?.id))
                                                .map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))
                                            }
                                        </select>
                                        <small style={{ color: 'hsl(var(--color-text-muted))', fontSize: '0.8rem', display: 'block', marginTop: '0.25rem' }}>
                                            عند بيع هذا المنتج، سيتم خصم الكمية من رصيد المنتج المختار هنا.
                                        </small>
                                    </div>

                                    {/* Conditional Deduct Amount */}
                                    {formData.deductFromProduct && (
                                        <div className="input-group" style={{
                                            marginRight: '1rem', borderRight: '2px solid #fdba74', paddingRight: '1rem',
                                            animation: 'fadeIn 0.3s ease-in-out'
                                        }}>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', color: '#c2410c' }}>
                                                كمية الخصم
                                            </label>
                                            <input
                                                type="number"
                                                className="input-field"
                                                value={formData.deductAmount}
                                                onChange={e => setFormData({ ...formData, deductAmount: e.target.value })}
                                                step="any"
                                                min="0"
                                                placeholder="1"
                                                style={{ borderColor: '#fdba74', backgroundColor: '#fff7ed' }}
                                            />
                                            <small style={{ color: '#ea580c', fontSize: '0.8rem' }}>
                                                مقدار ما يتم خصمه من المنتج الأصلي عند بيع حبة واحدة من هذا المنتج.
                                            </small>
                                            <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                                        </div>
                                    )}

                                    {!editingProduct && (
                                        <div style={{ marginTop: '2rem', backgroundColor: '#f0f9ff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #bae6fd' }}>
                                            <label style={{ display: 'block', marginBottom: '1rem', fontWeight: '700', color: '#0369a1', fontSize: '0.95rem' }}>
                                                🏢 خيارات الإضافة للفروع
                                            </label>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                                                    <input
                                                        type="radio"
                                                        name="targetBranch"
                                                        value="current"
                                                        checked={formData.targetBranch === 'current'}
                                                        onChange={e => setFormData({ ...formData, targetBranch: e.target.value })}
                                                        style={{ width: '1.1rem', height: '1.1rem' }}
                                                    />
                                                    <span style={{ color: '#334155' }}>إضافة للفرع الحالي فقط <strong>({selectedCity === 'ryad' ? 'الرياض' : 'خارج الرياض'})</strong></span>
                                                </label>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                                                    <input
                                                        type="radio"
                                                        name="targetBranch"
                                                        value="both"
                                                        checked={formData.targetBranch === 'both'}
                                                        onChange={e => setFormData({ ...formData, targetBranch: e.target.value })}
                                                        style={{ width: '1.1rem', height: '1.1rem' }}
                                                    />
                                                    <span style={{ color: '#334155' }}>إضافة <strong>لكلا الفرعين</strong> في وقت واحد</span>
                                                </label>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Footer Actions */}
                            <div style={{ display: 'flex', gap: '1rem', marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: '1px solid #f1f5f9' }}>
                                <button type="submit" className="btn btn-primary" style={{ flex: 2, padding: '0.85rem', fontSize: '1rem' }}>
                                    {isSubmitting ? 'جاري الحفظ...' : 'حفظ البيانات'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCloseModal}
                                    className="btn"
                                    style={{ flex: 1, backgroundColor: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0' }}
                                >
                                    إلغاء
                                </button>
                            </div>

                            {/* Timestamps Footer */}
                            {editingProduct && (
                                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #eee', fontSize: '0.8rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>
                                        تاريخ الإنشاء: {editingProduct.createdAt?.seconds ? new Date(editingProduct.createdAt.seconds * 1000).toLocaleString('en-GB') : '-'}
                                    </span>
                                    <span>
                                        آخر تعديل: {editingProduct.updatedAt?.seconds ? new Date(editingProduct.updatedAt.seconds * 1000).toLocaleString('en-GB') : '-'}
                                    </span>
                                </div>
                            )}
                        </form>
                    </div>
                </div>
            )}

            {/* Opening Stock Correction Modal */}
            {isStockModalOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1100,
                    display: 'flex', justifyContent: 'center', alignItems: 'center'
                }}>
                    <div style={{
                        backgroundColor: '#fff', borderRadius: '12px',
                        padding: '2rem',
                        width: settlementHistory.length > 0 ? '800px' : '90%',
                        maxWidth: '95%',
                        maxHeight: '90vh', overflowY: 'auto',
                        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
                    }}>
                        <h3 style={{ margin: '0 0 1.5rem', textAlign: 'center' }}>تصحيح الرصيد الافتتاحي</h3>

                        {editingStockItem && products.some(p => p.parentProduct === editingStockItem.id) && (!newStockValue || newStockValue == 0) && (
                            <div style={{
                                backgroundColor: '#fff7ed', border: '1px solid #fdba74',
                                color: '#9a3412', padding: '1rem', borderRadius: '8px',
                                marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: '1.5'
                            }}>
                                <strong>⚠️ تنويه:</strong> هذا المنتج جديد ولديه منتجات فرعية. <br />
                                يفضل استخدام <strong>"⚡ تسوية تلقائية"</strong> لترحيل الأرصدة والعمليات السابقة للمنتجات الفرعية إلى هذا المنتج الرئيسي.
                            </div>
                        )}

                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                                المنتج: <strong>{editingStockItem?.name}</strong>
                            </label>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                                الوحدة: <strong>{editingStockItem?.unit}</strong>
                            </label>
                            <input
                                type="number"
                                className="input-field"
                                value={newStockValue}
                                onChange={(e) => setNewStockValue(e.target.value)}
                                placeholder="أدخل الرصيد الصحيح"
                                autoFocus
                            />
                            <button
                                onClick={handleAutoSettle}
                                disabled={isSubmitting}
                                style={{
                                    marginTop: '0.5rem', fontSize: '12px',
                                    padding: '4px 8px', backgroundColor: '#e0f2fe', color: '#0284c7',
                                    border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                                }}
                            >
                                ⚡ تسوية تلقائية (حسب السجلات السابقة)
                            </button>
                        </div>

                        {/* Verification Table */}
                        {settlementHistory.length > 0 && (
                            <div style={{ marginTop: '1.5rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
                                <h4 style={{ margin: '0 0 1rem', fontSize: '14px', color: '#64748b' }}>سجل العمليات السابقة (للتدقيق):</h4>
                                <div style={{ overflowX: 'auto', maxHeight: '300px', border: '1px solid #eee', borderRadius: '6px' }}>
                                    <table style={{ width: '100%', fontSize: '12px', textAlign: 'right', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ backgroundColor: '#f8fafc', position: 'sticky', top: 0 }}>
                                                <th style={{ padding: '8px', borderBottom: '1px solid #eee' }}>التاريخ</th>
                                                <th style={{ padding: '8px', borderBottom: '1px solid #eee' }}>افتتاحية الرصيد</th>
                                                <th style={{ padding: '8px', borderBottom: '1px solid #eee' }}>استلام</th>
                                                <th style={{ padding: '8px', borderBottom: '1px solid #eee' }}>إضافة</th>
                                                <th style={{ padding: '8px', borderBottom: '1px solid #eee' }}>مبيعات</th>
                                                <th style={{ padding: '8px', borderBottom: '1px solid #eee' }}>تحويل</th>
                                                <th style={{ padding: '8px', borderBottom: '1px solid #eee' }}>تالف</th>
                                                <th style={{ padding: '8px', borderBottom: '1px solid #eee' }}>وجبة</th>
                                                <th style={{ padding: '8px', borderBottom: '1px solid #eee' }}>الصافي</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {settlementHistory.map((dayData, hIdx) => {
                                                const { parent, children, date, calculatedOpening, calculatedClosing } = dayData;
                                                const val = (v) => Number(v || 0);

                                                // Helper to sum and list
                                                const getSumAndList = (field) => {
                                                    let total = parent ? val(parent[field]) : 0;
                                                    let details = [];

                                                    // For Received/Transfer, Parent value is in Units (Boxes), so convert to Pieces for display consistency
                                                    const isUnitField = ['recieved', 'transfer'].includes(field);
                                                    const parentRaw = val(parent?.[field]);
                                                    const parentDisplay = isUnitField ? parentRaw * unit : parentRaw;

                                                    if (parent && parentRaw > 0) details.push({ name: 'رئيسي', val: parentDisplay });

                                                    if (children) {
                                                        children.forEach(c => {
                                                            const v = val(c[field]);
                                                            if (v > 0) {
                                                                total += v; // This total is local sum, but return uses breakdowns?.[field]
                                                                details.push({ name: c.productName, val: v });
                                                            }
                                                        });
                                                    }
                                                    return { total: dayData.breakdowns?.[field] || total, details };
                                                };

                                                const opening = calculatedOpening !== undefined ? calculatedOpening : 0;
                                                const net = calculatedClosing !== undefined ? calculatedClosing : 0;

                                                const unit = Number(editingStockItem.unit) || 1;

                                                const recData = getSumAndList('recieved');
                                                const transData = getSumAndList('transfer');
                                                const addData = getSumAndList('add');
                                                const salesData = getSumAndList('sales');
                                                const damData = getSumAndList('dameged');
                                                const staffData = getSumAndList('staffMeal');

                                                let dateStr = '-';
                                                if (date?.seconds) {
                                                    const d = new Date(date.seconds * 1000);
                                                    dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                                }

                                                // Render Cell with Details
                                                const renderCellWithDetails = (data, color) => (
                                                    <td style={{ padding: '6px 8px', color: color }}>
                                                        {data.total || '-'}
                                                        {data.details.length > 0 && (
                                                            <div style={{ fontSize: '0.7em', color: '#64748b', whiteSpace: 'nowrap' }}>
                                                                {data.details.map((d, i) => (
                                                                    <span key={i}>{d.name}:{d.val} {i < data.details.length - 1 ? '| ' : ''}</span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </td>
                                                );

                                                return (
                                                    <tr key={hIdx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                        <td style={{ padding: '6px 8px' }}>{dateStr}</td>
                                                        <td style={{ padding: '6px 8px', color: '#16a34a', fontWeight: 'bold' }}>
                                                            {opening}
                                                            <div style={{ fontSize: '0.7em', color: '#64748b' }}>
                                                                {hIdx === 0 ? '(أصل)' : '(مرحل)'}
                                                            </div>
                                                            {(parent || (children && children.length > 0)) && (
                                                                <div style={{ fontSize: '0.7em', color: '#64748b', whiteSpace: 'nowrap', marginTop: '2px' }}>
                                                                    {parent && val(parent.openingStockQnt) > 0 && <span>رئيسي:{val(parent.openingStockQnt)} </span>}
                                                                    {children && children.map((c, i) => (
                                                                        val(c.openingStockQnt) > 0 && <span key={i}>| {c.productName}:{val(c.openingStockQnt)} </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </td>
                                                        {renderCellWithDetails(recData, '#16a34a')}
                                                        {renderCellWithDetails(addData, '#16a34a')}
                                                        {renderCellWithDetails(salesData, '#dc2626')}
                                                        {renderCellWithDetails(transData, '#dc2626')}
                                                        {renderCellWithDetails(damData, '#dc2626')}
                                                        {renderCellWithDetails(staffData, '#dc2626')}
                                                        <td style={{ padding: '6px 8px', fontWeight: 'bold', dir: 'ltr' }}>{net}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                            <button
                                onClick={handleSaveStock}
                                disabled={isSubmitting}
                                className="btn btn-primary"
                                style={{ flex: 1 }}
                            >
                                {isSubmitting ? 'جاري الحفظ...' : 'حفظ التعديل'}
                            </button>
                            <button
                                onClick={() => setIsStockModalOpen(false)}
                                className="btn btn-secondary"
                                style={{ flex: 1, backgroundColor: '#f1f5f9', color: '#64748b' }}
                            >
                                إلغاء
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Notification Toast */}
            {
                notification && (
                    <div style={{
                        position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
                        backgroundColor: notification.type === 'error' ? '#fee2e2' : '#dcfce7',
                        color: notification.type === 'error' ? '#ef4444' : '#16a34a',
                        padding: '1rem 2rem', borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                        zIndex: 2000, fontWeight: '600'
                    }}>
                        {notification.message}
                    </div>
                )
            }

            {/* Loading Overlay */}
            {
                isSubmitting && (
                    <div style={{
                        position: 'fixed', inset: 0, backgroundColor: 'rgba(255,255,255,0.7)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000
                    }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <div style={{ width: '40px', height: '40px', border: '4px solid #f3f3f3', borderTop: '4px solid var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                            <span style={{ marginTop: '1rem', fontWeight: '600', color: 'hsl(var(--color-primary))' }}>جاري التنفيذ...</span>
                        </div>
                        <style>{`
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    `}</style>
                    </div>
                )
            }

        </DashboardLayout >
    );
};

export default AdminDashboard;
