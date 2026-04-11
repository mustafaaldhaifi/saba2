import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../../layouts/DashboardLayout';
import { collection, query, where, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, setDoc, orderBy, Timestamp, writeBatch } from "firebase/firestore";
import { db } from '../../config/firebase';
import MonthlyBranchReport from './MonthlyBranchReport';
import GlobalMonthlyReport from './GlobalMonthlyReport';

// Helper: Calculate Remaining Stock
// Helper: Calculate Remaining Stock
// Helper: Calculate Remaining Stock
const calculateRemaining = (reports, product) => {
    const val = (v) => Number(v || 0);
    const unit = Number(product?.unit) || 1;
    const { parent, children } = reports || {};

    // 1. Opening Stock

    const parentOp = val(parent?.openingStockQnt);
    const childOp = children ? children.reduce((acc, c) => acc + val(c?.openingStockQnt), 0) : 0;
    const openingStock = parentOp + childOp;


    // 2. Helper to get total for a field (Parent * Unit + Children)
    const getFieldTotal = (field) => {
        const pVal = val(parent?.[field]);
        const cVal = children ? children.reduce((acc, c) => acc + val(c?.[field]), 0) : 0;

        // For Sales/Consumption, if children exist, only count children sales (ignore parent "main" count to avoid duplicates)
        if (children && children.length > 0 && ['sales', 'staffMeal', 'dameged'].includes(field)) {
            return cVal;
        }

        // اضرب الأب في الوحدة، واجمع الأبناء كما هم
        return (pVal * unit) + cVal;
    };

    const totalRec = getFieldTotal('recieved');
    const totalTrans = getFieldTotal('transfer');
    const totalAdd = getFieldTotal('add');
    const totalSales = getFieldTotal('sales');
    const totalStaff = getFieldTotal('staffMeal');
    const totalDamaged = getFieldTotal('dameged');

    // 3. Calculation
    const total = openingStock + totalRec + totalAdd - totalSales - totalStaff - totalTrans - totalDamaged;

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
    const [showMonthlyReport, setShowMonthlyReport] = useState(false);
    const [showGlobalMonthlyReport, setShowGlobalMonthlyReport] = useState(false);

    const location = useLocation();
    const navigate = useNavigate();
    const searchParams = new URLSearchParams(location.search);
    const tabFromUrl = searchParams.get('tab') || 'home';

    // Active View State (home | products | reports)
    const [activeTab, setActiveTabState] = useState(tabFromUrl);

    useEffect(() => {
        if (tabFromUrl !== activeTab) {
            setActiveTabState(tabFromUrl);
        }
    }, [tabFromUrl]);

    const setActiveTab = (tab) => {
        setActiveTabState(tab);
        navigate(`/admin${tab === 'home' ? '' : `?tab=${tab}`}`);
    };

    // Data
    const [orderTypes, setOrderTypes] = useState([]);
    const [branches, setBranches] = useState([]); // Dynamic
    const [products, setProducts] = useState([]);
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [linkStatus, setLinkStatus] = useState({}); // { ryad: true, other: false }
    const [potentialMatches, setPotentialMatches] = useState([]); // Products with same name but no linkId/different linkId

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
        deductions: [],
        showOn: ['*'],
        linkId: ''
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


    const handleOpenModal = async (product = null) => {
        setLinkStatus({});
        setPotentialMatches([]); // Reset
        if (product) {
            setEditingProduct(product);
            const currentLinkId = product.linkId || '';

            // Initialize status with current product's city to avoid showing it as missing
            const initialStatus = {};
            if (product.city) initialStatus[product.city] = true;
            setLinkStatus(initialStatus);

            setFormData({
                name: product.name || '',
                unit: product.unit || '',
                unitF: product.unitF || '',
                parentProduct: product.parentProduct || '',
                sortOrder: product.sortOrder || 0,
                isSales: product.isSales || false,
                deductions: product.deductions || [],
                showOn: product.showOn || (product.city ? [] : ['*']), // Default to * if no specific data, or based on legacy
                linkId: currentLinkId
            });

            // 1. Check link status (same linkId) across other cities
            if (currentLinkId) {
                try {
                    const status = { ...initialStatus };
                    const q = query(collection(db, "products"), where("linkId", "==", currentLinkId));
                    const snap = await getDocs(q);
                    snap.forEach(d => {
                        const data = d.data();
                        if (data.city) status[data.city] = true;
                    });
                    setLinkStatus(status);
                } catch (e) {
                    console.error("Error fetching link status:", e);
                }
            }

            // 2. Search for potential matches by Name + Type in other cities (different linkId)
            try {
                const qMatch = query(collection(db, "products"),
                    where("name", "==", product.name),
                    where("typeId", "==", product.typeId)
                );
                const snapMatch = await getDocs(qMatch);
                const matches = snapMatch.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(m => m.id !== product.id && m.linkId !== currentLinkId && m.city !== product.city);

                setPotentialMatches(matches);
            } catch (e) {
                console.error("Error fetching potential matches:", e);
            }

        } else {
            setEditingProduct(null);
            setFormData({
                name: '',
                unit: '',
                unitF: '',
                parentProduct: '',
                sortOrder: 0,
                isSales: false,
                deductions: [],
                showOn: ['*'], // Default to All
                linkId: doc(collection(db, "products")).id // Pre-generate a linkId for new products
            });
        }
        setIsModalOpen(true);
    };

    const handleManualLink = async () => {
        if (!editingProduct || potentialMatches.length === 0) return;

        const confirmMsg = `تم العثور على ${potentialMatches.length} نتائج مطابقة لاسم المنتج في فروع أخرى. هل تريد ربط هذه المنتجات معاً ليكون لها نفس الرابط الموحد؟`;
        if (!window.confirm(confirmMsg)) return;

        setIsSubmitting(true);
        try {
            const batch = writeBatch(db);
            const commonLinkId = editingProduct.linkId || doc(collection(db, "products")).id;

            // Update current product
            batch.update(doc(db, "products", editingProduct.id), {
                linkId: commonLinkId,
                updatedAt: serverTimestamp()
            });

            // Update all matches
            potentialMatches.forEach(m => {
                batch.update(doc(db, "products", m.id), {
                    linkId: commonLinkId,
                    updatedAt: serverTimestamp()
                });
            });

            await batch.commit();
            showNotification('success', "تم ربط المنتجات بنجاح");

            // Refresh modal state
            handleOpenModal({ ...editingProduct, linkId: commonLinkId });
        } catch (error) {
            console.error("Manual Link Error:", error);
            showNotification('error', "فشل في عملية الربط اليدوي");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSyncToOtherCity = async (targetCity) => {
        if (!editingProduct) return;

        const confirmMsg = `هل تريد إنشاء نسخة من هذا المنتج في فرع ${targetCity === 'ryad' ? 'الرياض' : 'خارج الرياض'} وربطهما معاً؟ سيتم نسخ جميع التفاصيل (الاسم، الوحدات، الخصم)`;
        if (!window.confirm(confirmMsg)) return;

        setIsSubmitting(true);
        try {
            const currentLinkId = editingProduct.linkId || doc(collection(db, "products")).id;

            // 1. Ensure current product has the linkId
            if (!editingProduct.linkId) {
                await updateDoc(doc(db, "products", editingProduct.id), {
                    linkId: currentLinkId,
                    updatedAt: serverTimestamp()
                });
            }

            // 2. Prepare Payload
            const payload = {
                name: formData.name,
                unit: formData.unit,
                unitF: formData.unitF,
                typeId: editingProduct.typeId,
                parentProduct: formData.parentProduct || null,
                sortOrder: Number(formData.sortOrder) || 0,
                isSales: formData.isSales || false,
                deductions: formData.deductions ? formData.deductions.filter(d => d.productId && d.amount > 0) : [],
                showOn: formData.showOn,
                linkId: currentLinkId,
                city: targetCity,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };

            await addDoc(collection(db, "products"), payload);
            await triggerUpdate(targetCity, editingProduct.typeId);

            showNotification('success', "تم إنشاء وربط المنتج بالفرع الآخر بنجاح");

            // Refresh modal state
            handleOpenModal({ ...editingProduct, linkId: currentLinkId });
        } catch (error) {
            console.error("Sync Error:", error);
            showNotification('error', "فشل في عملية المزامنة للفرع الآخر");
        } finally {
            setIsSubmitting(false);
        }
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
            // 1. Determine or Generate Link ID (Unique identifier across cities)
            let linkId = formData.linkId;
            if (!linkId) {
                linkId = doc(collection(db, "products")).id;
            }

            // Base Data
            const baseData = {
                name: formData.name,
                unit: formData.unit,
                unitF: formData.unitF,
                typeId: selectedOrderType,
                parentProduct: formData.parentProduct || null,
                sortOrder: Number(formData.sortOrder) || 0,
                isSales: formData.isSales || false,
                deductions: formData.deductions ? formData.deductions.filter(d => d.productId && d.amount > 0) : [],
                showOn: formData.showOn,
                linkId: linkId, // Crucial: Always include the linkId
                updatedAt: serverTimestamp()
            };

            // Determine Target City
            const targetCity = editingProduct ? editingProduct.city : selectedCity;

            let docRef = null;

            // 1. Determine Target Document Reference
            if (editingProduct) {
                // UPDATE: Use the exact document ID
                docRef = doc(db, "products", editingProduct.id);
            }
            // If adding new, we leave docRef as null so it creates a new document.
            // We NO LONGER search by name to avoid overwriting existing items when adding new ones.

            // 2. Payload Preparation
            const payload = { ...baseData, city: targetCity };
            let newLocalList = [...products];

            // 3. Upsert (Update or Create)
            if (docRef) {
                // UPDATE
                await updateDoc(docRef, payload);

                if (targetCity === selectedCity) {
                    newLocalList = newLocalList.map(p => p.id === docRef.id ? { ...p, ...payload, id: docRef.id } : p);
                }
            } else {
                // CREATE
                const createPayload = { ...payload, createdAt: serverTimestamp() };
                const res = await addDoc(collection(db, "products"), createPayload);

                if (targetCity === selectedCity) {
                    newLocalList.push({
                        id: res.id,
                        ...payload,
                        createdAt: { seconds: Date.now() / 1000 }
                    });
                }
            }

            await triggerUpdate(targetCity, selectedOrderType);

            // Finalize Local State
            const sortedList = newLocalList.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
            setProducts(sortedList);

            const cacheKey = `products_${selectedCity}_${selectedOrderType}`;
            localStorage.setItem(cacheKey, JSON.stringify({
                items: sortedList,
                lastSync: Date.now()
            }));

            showNotification('success', editingProduct ? "تم تحديث المنتج والفروع المحددة" : "تم إضافة المنتج للفروع المحددة");
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
            // 1. Fetch History & Calculate
            const childProducts = products.filter(p => p.parentProduct === editingStockItem.id);
            const targetIds = [editingStockItem.id, ...childProducts.map(p => p.id)];

            // Parallel Fetch
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

            // Flatten and Group
            const rawDocs = snapshots.flatMap(s => s.docs.map(d => d.data()));
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

            // Convert and Sort
            const history = Object.values(groupedByDate).sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));

            // Calculate Flow for ALL history (User requested full view)
            const val = (v) => Number(v || 0);
            const unit = Number(editingStockItem.unit) || 1;
            let runningBalance = 0;
            let finalStock = 0;
            const calculatedHistory = history.map((dayArgs, idx) => {
                const { parent, children } = dayArgs;

                // Calculate logic unified with calculateRemaining
                const sum = (field) => {
                    const pVal = parent ? val(parent[field]) : 0;
                    const cVal = (children && children.length > 0) ? children.reduce((acc, c) => acc + val(c[field]), 0) : 0;

                    // Exclude Parent "Main" count for consumption if Children exist
                    if (children && children.length > 0 && ['sales', 'staffMeal', 'dameged'].includes(field)) {
                        return cVal;
                    }

                    // Otherwise sum Parent (Converted) + Children
                    return (pVal * unit) + cVal;
                };

                const add = sum('add');
                const sales = sum('sales');
                const dameged = sum('dameged');
                const staffMeal = sum('staffMeal');
                const totalRec = sum('recieved');
                const totalTrans = sum('transfer');



                const closing = calculateRemaining(
                    { parent, children },
                    { unit }
                );

                runningBalance = closing; // Loop

                return {
                    ...dayArgs,
                    calculatedOpening: val(parent?.openingStockQnt, 0),
                    calculatedClosing: closing,
                    breakdowns: {
                        add, sales, dameged, staffMeal, recieved: totalRec, transfer: totalTrans
                    }
                };
            });

            setSettlementHistory(calculatedHistory);

            setNewStockValue(finalStock); // Update UI Input ONLY
            showNotification('success', `تم الحساب. الرصيد المقترح: ${finalStock}. اضغط حفظ للتثبيت.`);

        } catch (error) {
            console.error("Auto Settle Error:", error);
            showNotification('error', "فشل الحساب والتسوية");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSaveStock = async () => {
        if (!editingStockItem || !selectedBranch || !selectedOrderType) return;

        setIsSubmitting(true);
        try {
            const batch = writeBatch(db);
            const val = Number(newStockValue);

            // 1. Update OpeningStock Collection
            const q = query(
                collection(db, "openingStock"),
                where("branchId", "==", selectedBranch),
                where("typeId", "==", selectedOrderType),
                where("productId", "==", editingStockItem.id)
            );
            const snapshot = await getDocs(q);

            let osRef;
            if (!snapshot.empty) {
                // UPDATE
                const docId = snapshot.docs[0].id;
                osRef = doc(db, "openingStock", docId);
                batch.update(osRef, {
                    openingStockQnt: val,
                    updatedAt: serverTimestamp()
                });

                // Optimistic Local Update
                setOpeningStockData(prev => prev.map(o =>
                    o.id === docId ? { ...o, openingStockQnt: val } : o
                ));
            } else {
                // CREATE
                osRef = doc(collection(db, "openingStock"));
                const newDoc = {
                    branchId: selectedBranch,
                    typeId: selectedOrderType,
                    productId: editingStockItem.id,
                    openingStockQnt: val,
                    createdAt: serverTimestamp()
                };
                batch.set(osRef, newDoc);

                // Optimistic Local Update
                setOpeningStockData(prev => [...prev, { id: osRef.id, ...newDoc }]);
            }

            // 2. Update Daily Reports (Fix History) if Settlement ran
            if (settlementHistory.length > 0) {
                settlementHistory.forEach(day => {
                    if (day.parent && day.parent.id) {
                        const drRef = doc(db, "dailyReports", day.parent.id);
                        batch.update(drRef, {
                            openingStockQnt: day.calculatedOpening,
                            closeStock: day.calculatedClosing,
                            // We could update 'remaining' too if it was stored, but usually it's calculated
                        });
                    }
                });
            }

            // 3. Trigger Update Signal (Dynamic ID)
            const triggerQ = query(
                collection(db, "dailyReportsUpdates"),
                where("branchId", "==", selectedBranch),

            );
            const triggerSnap = await getDocs(triggerQ);

            if (!triggerSnap.empty) {
                // Update specific triggers found
                triggerSnap.forEach(d => {
                    batch.update(d.ref, { updatedAt: serverTimestamp() });
                });
            } else {
                // Create new trigger doc if missing
                const newTriggerRef = doc(collection(db, "dailyReportsUpdates"));
                batch.set(newTriggerRef, {
                    branchId: selectedBranch,
                    typeId: selectedOrderType,
                    updatedAt: serverTimestamp()
                });
            }

            await batch.commit();

            showNotification('success', "تم تعديل الرصيد وتحديث السجلات بنجاح");
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
        <DashboardLayout title={activeTab === 'home' ? "الرئيسية" : activeTab === 'products' ? "إدارة المنتجات" : "التقارير"} role="admin">

            {activeTab !== 'home' && (
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>
                    <button className={`btn ${activeTab === 'products' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('products')} style={{ background: activeTab === 'products' ? '' : 'transparent', color: activeTab === 'products' ? '#fff' : '#64748b', boxShadow: 'none', border: activeTab === 'products' ? 'none' : '1px solid #cbd5e1' }}>
                        📦 إدارة المنتجات
                    </button>
                    <button className={`btn ${activeTab === 'reports' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('reports')} style={{ background: activeTab === 'reports' ? '' : 'transparent', color: activeTab === 'reports' ? '#fff' : '#64748b', boxShadow: 'none', border: activeTab === 'reports' ? 'none' : '1px solid #cbd5e1' }}>
                        📊 التقارير
                    </button>
                    <button className="btn" onClick={() => setActiveTab('home')} style={{ background: '#f8fafc', color: '#64748b', boxShadow: 'none', border: '1px solid #cbd5e1', marginRight: 'auto' }}>
                        🏠 الرئيسية
                    </button>
                </div>
            )}

            {activeTab === 'home' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                    <h1 style={{ fontSize: '2.5rem', color: '#0f172a', marginBottom: '3rem', fontWeight: 'bold' }}>مرحباً بك في لوحة الإدارة</h1>
                    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <div onClick={() => setActiveTab('products')} style={{ cursor: 'pointer', backgroundColor: '#fff', borderRadius: '16px', padding: '3.5rem 2rem', width: '300px', textAlign: 'center', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', border: '1px solid #e2e8f0', transition: 'all 0.3s ease' }} onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-5px)'} onMouseOut={(e) => e.currentTarget.style.transform = 'none'}>
                            <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>📦</div>
                            <h2 style={{ fontSize: '1.75rem', color: '#0284c7', marginBottom: '1rem', fontWeight: 'bold' }}>إدارة المنتجات</h2>
                            <p style={{ color: '#64748b', fontSize: '1rem', lineHeight: '1.6' }}>إضافة، تعديل وحذف المنتجات وضبط الأرصدة الافتتاحية للمنتجات.</p>
                        </div>
                        <div onClick={() => setActiveTab('reports')} style={{ cursor: 'pointer', backgroundColor: '#fff', borderRadius: '16px', padding: '3.5rem 2rem', width: '300px', textAlign: 'center', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', border: '1px solid #e2e8f0', transition: 'all 0.3s ease' }} onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-5px)'} onMouseOut={(e) => e.currentTarget.style.transform = 'none'}>
                            <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>📊</div>
                            <h2 style={{ fontSize: '1.75rem', color: '#10b981', marginBottom: '1rem', fontWeight: 'bold' }}>التقارير</h2>
                            <p style={{ color: '#64748b', fontSize: '1rem', lineHeight: '1.6' }}>الاطلاع على تقارير الجرد اليومي والشهرية للفروع الشاملة والمفصلة.</p>
                        </div>
                    </div>
                </div>
            ) : (
                <>

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
                            {orderTypes
                                .filter(t => activeTab === 'reports' ? t.name.includes('يومي') : true)
                                .map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))
                            }
                        </select>
                    </div>

                    {/* Daily Report Date Select (Dynamic) */}
                    {activeTab === 'reports' && reportDates.length > 0 && (
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h2 style={{ fontSize: '1.5rem', color: activeTab === 'reports' ? '#10b981' : 'hsl(var(--color-primary))', fontWeight: '700' }}>
                    {activeTab === 'reports' ? 'التقارير المتاحة' : `قائمة المنتجات (${products.length})`}
                </h2>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {activeTab === 'products' && (
                        <button
                            className="btn btn-primary"
                            onClick={() => handleOpenModal()}
                            disabled={!selectedOrderType}
                            title={!selectedOrderType ? "اختر نوع الطلبية أولاً" : ""}
                        >
                            + إضافة منتج جديد
                        </button>
                    )}
                    {activeTab === 'reports' && selectedCity && selectedBranch && selectedOrderType && (
                        <button
                            className="btn"
                            style={{
                                backgroundColor: showMonthlyReport ? '#ef4444' : '#0284c7',
                                color: 'white',
                                border: 'none'
                            }}
                            onClick={() => setShowMonthlyReport(!showMonthlyReport)}
                        >
                            {showMonthlyReport ? 'إخفاء تقرير الشهر' : 'تقرير الشهر كامل'}
                        </button>
                    )}
                    {activeTab === 'reports' && selectedCity && selectedOrderType && (
                        <button
                            className="btn"
                            style={{
                                backgroundColor: showGlobalMonthlyReport ? '#ef4444' : '#10b981',
                                color: 'white',
                                border: 'none'
                            }}
                            onClick={() => {
                                setShowGlobalMonthlyReport(!showGlobalMonthlyReport);
                                if (!showGlobalMonthlyReport) setShowMonthlyReport(false);
                            }}
                        >
                            {showGlobalMonthlyReport ? 'إخفاء التقرير الشامل' : 'تقرير الفروع الشامل'}
                        </button>
                    )}
                </div>
            </div>

            {/* Monthly Report View */}
            {showMonthlyReport && selectedCity && selectedBranch && selectedOrderType && (
                <div style={{ marginBottom: '2rem' }}>
                    <MonthlyBranchReport
                        branchId={selectedBranch}
                        branches={branches.filter(b => b.city === selectedCity || (!b.city && selectedCity === 'ryad'))}
                        city={selectedCity}
                        typeId={selectedOrderType}
                        products={products}
                        onClose={() => setShowMonthlyReport(false)}
                        branchName={branches.find(b => b.id === selectedBranch)?.name || ''}
                    />
                </div>
            )}

            {/* Global Monthly Report View */}
            {showGlobalMonthlyReport && selectedCity && selectedOrderType && (
                <div style={{ marginBottom: '2rem' }}>
                    <GlobalMonthlyReport
                        branches={branches}
                        cityName={selectedCity}
                        typeId={selectedOrderType}
                        initialMonth={new Date().toISOString().substring(0, 7)}
                        onClose={() => setShowGlobalMonthlyReport(false)}
                        products={products}
                    />
                </div>
            )}

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
                                        {activeTab === 'reports' && (
                                            <>
                                                <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>المستلم</th>
                                                <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>الجرد</th>
                                                <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>مبيعات</th>
                                                <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>وجبة موظف</th>
                                                <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>تحويل %</th>
                                                <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>التالف</th>
                                                <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>المتبقي</th>
                                            </>
                                        )}
                                        {activeTab === 'products' && (
                                            <th style={{ width: '80px', padding: '10px', borderBottom: '2px solid #dee2e6' }}>إجراءات</th>
                                        )}
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
                                                                    {activeTab === 'products' && (
                                                                        <div style={{ marginTop: '5px', display: 'flex', gap: '4px', fontSize: '10px' }}>
                                                                            <span title="تعديل الأب" onClick={(e) => { e.stopPropagation(); handleOpenModal(item); }}>✏️</span>
                                                                            <span title="حذف الأب" onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}>❌</span>
                                                                        </div>
                                                                    )}
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
                                                    {['openingStockQnt', 'actualOpening', 'recieved', 'add', 'sales', 'staffMeal', 'transfer', 'dameged', 'closeStock'].map(field => {
                                                        
                                                        if (activeTab === 'products' && !['openingStockQnt', 'actualOpening'].includes(field)) {
                                                            return null;
                                                        }

                                                        const isParentField = ['openingStockQnt', 'actualOpening', 'recieved', 'transfer', 'closeStock'].includes(field);

                                                        // Case 1: Has Children & Field is Parent-Only -> Render Single Value for Parent
                                                        if (hasChildren && isParentField) {
                                                            const parentReport = dailyReportData.find(d => d.productId === item.id) || {};

                                                            let displayValue = '-';
                                                            if (field === 'remaining') {
                                                                const childReports = children.map(c => dailyReportData.find(d => d.productId === c.id));
                                                                displayValue = calculateRemaining({ parent: parentReport, children: childReports }, item);
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
                                                                        {field === 'remaining' && (() => {
                                                                            const storedClose = (Number(parentReport?.closeStock) || 0) +
                                                                                (children ? children.reduce((acc, c) => {
                                                                                    const cr = dailyReportData.find(d => d.productId === c.id);
                                                                                    return acc + (Number(cr?.closeStock) || 0);
                                                                                }, 0) : 0);
                                                                            const currentVal = Number(displayValue);
                                                                            if (isNaN(currentVal)) return null;

                                                                            const isMatch = Math.abs(currentVal - storedClose) < 0.1;
                                                                            return (
                                                                                <span title={`المخزن: ${storedClose}`} style={{ marginRight: '5px', fontSize: '10px', cursor: 'help', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                                                    {isMatch ? '✅' : '❓'}
                                                                                    <span style={{ color: 'gray' }}>{storedClose}</span>
                                                                                </span>
                                                                            );
                                                                        })()}
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
                                                                            displayValue = calculateRemaining({ parent: report }, rowItem);
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
                                                                                {field === 'remaining' && (() => {
                                                                                    const storedClose = Number(report?.closeStock) || 0;
                                                                                    const currentVal = Number(displayValue);
                                                                                    // Show verification only if both are numbers (handles '-' case)
                                                                                    if (isNaN(currentVal)) return null;

                                                                                    const isMatch = Math.abs(currentVal - storedClose) < 0.1;
                                                                                    return (
                                                                                        <span title={`المخزن: ${storedClose}`} style={{ marginRight: '5px', fontSize: '10px', cursor: 'help', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                                                            {isMatch ? '✅' : '❓'}
                                                                                            <span style={{ color: 'gray' }}>{storedClose}</span>
                                                                                        </span>
                                                                                    );
                                                                                })()}
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
                                                    {activeTab === 'products' && (
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
                                                    )}
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
            </>
            )}

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
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type="text"
                                                className="input-field"
                                                value={formData.name}
                                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                                required
                                                placeholder="أدخل اسم المنتج"
                                                style={{ borderColor: formData.name ? '#e2e8f0' : '#fca5a5', paddingLeft: '40px' }}
                                            />
                                            {editingProduct && (
                                                <div style={{
                                                    position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)',
                                                    fontSize: '18px', cursor: 'help'
                                                }} title={Object.keys(linkStatus).length > 1 ? "هذا المنتج مربوط مع فروع أخرى" : "هذا المنتج غير مربوط مع فروع أخرى"}>
                                                    {Object.keys(linkStatus).length > 1 ? '🔗' : '⚠️'}
                                                </div>
                                            )}
                                        </div>
                                        {editingProduct && (
                                            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                                {['ryad', 'other'].map(cityCode => {
                                                    const exists = linkStatus[cityCode];
                                                    const cityMatches = potentialMatches.filter(m => m.city === cityCode);

                                                    return (
                                                        <span key={cityCode} style={{
                                                            fontSize: '11px', padding: '2px 8px', borderRadius: '12px',
                                                            backgroundColor: exists ? '#dcfce7' : '#fee2e2',
                                                            color: exists ? '#166534' : '#991b1b',
                                                            border: `1px solid ${exists ? '#bbf7d0' : '#fecaca'}`,
                                                            display: 'flex', alignItems: 'center', gap: '4px'
                                                        }}>
                                                            {exists ? '✅' : '❌'} {cityCode === 'ryad' ? 'الرياض' : 'خارج الرياض'}

                                                            {!exists && cityMatches.length === 0 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleSyncToOtherCity(cityCode)}
                                                                    style={{
                                                                        marginLeft: '4px', border: 'none', background: '#991b1b',
                                                                        color: 'white', borderRadius: '50%', width: '14px',
                                                                        height: '14px', fontSize: '10px', cursor: 'pointer',
                                                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                                    }}
                                                                    title="إنشاء نسخة مربوطة في هذا الفرع"
                                                                >
                                                                    +
                                                                </button>
                                                            )}
                                                        </span>
                                                    );
                                                })}

                                                {potentialMatches.length > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={handleManualLink}
                                                        style={{
                                                            fontSize: '11px', padding: '2px 10px', borderRadius: '6px',
                                                            backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe',
                                                            cursor: 'pointer', fontWeight: '600'
                                                        }}
                                                    >
                                                        🔗 ربط مع {potentialMatches.length} تطابق بالاسم
                                                    </button>
                                                )}
                                            </div>
                                        )}
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

                                    {/* Deductions / Ingredients Section */}
                                    <div style={{ marginBottom: '1rem', border: '1px solid #e2e8f0', padding: '1rem', borderRadius: '8px', backgroundColor: '#fff7ed' }}>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', color: '#c2410c' }}>
                                            خصم من المخزون (المكونات)
                                        </label>
                                        <small style={{ display: 'block', marginBottom: '1rem', color: '#9a3412', fontSize: '13px' }}>
                                            يمكنك تحديد أكثر من منتج ليتم خصمهم عند بيع هذا الصنف. (يعمل فقط على نفس الفرع)
                                        </small>

                                        {formData.deductions && formData.deductions.map((deduction, idx) => (
                                            <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                                                <div style={{ flex: 2 }}>
                                                    <select
                                                        className="input-field"
                                                        value={deduction.productId}
                                                        onChange={e => {
                                                            const newDeductions = [...formData.deductions];
                                                            newDeductions[idx] = { ...newDeductions[idx], productId: e.target.value };
                                                            setFormData({ ...formData, deductions: newDeductions });
                                                        }}
                                                        style={{ backgroundColor: '#fff', fontSize: '13px' }}
                                                    >
                                                        <option value="">-- اختر المنتج --</option>
                                                        {products
                                                            .filter(p => p.id !== (editingProduct?.id))
                                                            .map(p => (
                                                                <option key={p.id} value={p.id}>{p.name}</option>
                                                            ))
                                                        }
                                                    </select>
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <input
                                                        type="number"
                                                        className="input-field"
                                                        value={deduction.amount}
                                                        onChange={e => {
                                                            const newDeductions = [...formData.deductions];
                                                            newDeductions[idx] = { ...newDeductions[idx], amount: e.target.value };
                                                            setFormData({ ...formData, deductions: newDeductions });
                                                        }}
                                                        placeholder="الكمية"
                                                        step="any"
                                                        min="0"
                                                        style={{ backgroundColor: '#fff', fontSize: '13px' }}
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const newDeductions = formData.deductions.filter((_, i) => i !== idx);
                                                        setFormData({ ...formData, deductions: newDeductions });
                                                    }}
                                                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#ef4444', marginTop: '8px' }}
                                                    title="حذف"
                                                >
                                                    ❌
                                                </button>
                                            </div>
                                        ))}

                                        <button
                                            type="button"
                                            onClick={() => {
                                                setFormData({
                                                    ...formData,
                                                    deductions: [...(formData.deductions || []), { productId: '', amount: 1 }]
                                                });
                                            }}
                                            style={{
                                                marginTop: '0.5rem',
                                                border: '1px dashed #fdba74',
                                                backgroundColor: '#fff',
                                                color: '#c2410c',
                                                width: '100%',
                                                padding: '0.5rem',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontSize: '13px'
                                            }}
                                        >
                                            + إضافة مكون آخر
                                        </button>
                                    </div>

                                    <div style={{ marginTop: '2rem', backgroundColor: '#f0f9ff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #bae6fd' }}>
                                        <div style={{ marginBottom: '1rem' }}>
                                            <label style={{ display: 'block', fontWeight: '700', color: '#0369a1', fontSize: '0.95rem', marginBottom: '0.5rem' }}>
                                                🏢 توفر المنتج في الفروع
                                            </label>

                                            {/* All Branches Option */}
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: '1rem', fontWeight: 'bold' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={formData.showOn.includes('*')}
                                                    onChange={e => {
                                                        const checked = e.target.checked;
                                                        if (checked) {
                                                            setFormData({ ...formData, showOn: ['*'] });
                                                        } else {
                                                            setFormData({ ...formData, showOn: [] });
                                                        }
                                                    }}
                                                    style={{ width: '1.2rem', height: '1.2rem', accentColor: '#0369a1' }}
                                                />
                                                <span style={{ color: '#0369a1' }}>كل الفروع (*)</span>
                                            </label>

                                            {/* Specific Branches List - Filtered by current City */}
                                            {!formData.showOn.includes('*') && (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '1.5rem', borderRight: '2px solid #e2e8f0' }}>
                                                    <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>
                                                        اختر الفروع في مدينة <strong>{selectedCity === 'ryad' ? 'الرياض' : 'خارج الرياض'}</strong>:
                                                    </div>
                                                    {branches
                                                        .filter(b => (!b.city && selectedCity === 'ryad') || b.city === selectedCity)
                                                        .map(branch => (
                                                            <label key={branch.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    value={branch.id}
                                                                    checked={formData.showOn.includes(branch.id)}
                                                                    onChange={e => {
                                                                        const checked = e.target.checked;
                                                                        setFormData(prev => {
                                                                            const current = prev.showOn.filter(x => x !== '*');
                                                                            const newTargets = checked
                                                                                ? [...current, branch.id]
                                                                                : current.filter(t => t !== branch.id);
                                                                            return { ...prev, showOn: newTargets };
                                                                        });
                                                                    }}
                                                                    style={{ width: '1.1rem', height: '1.1rem' }}
                                                                />
                                                                <span style={{ color: '#334155' }}>
                                                                    {branch.name}
                                                                </span>
                                                            </label>
                                                        ))}
                                                    {branches.filter(b => (!b.city && selectedCity === 'ryad') || b.city === selectedCity).length === 0 && (
                                                        <div style={{ color: '#ef4444', fontSize: '0.9rem' }}>لا توجد فروع مضافة لهذه المدينة بعد.</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
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
                                                    const isUnitField = ['recieved', 'transfer', 'add', 'openingStockQnt'].includes(field);
                                                    const parentRaw = val(parent?.[field]);
                                                    const parentDisplay = isUnitField ? parentRaw * unit : parentRaw;

                                                    // Logic: Exclude Parent Sales if Children exist
                                                    const shouldExcludeParent = (children && children.length > 0) && ['sales', 'staffMeal', 'dameged'].includes(field);

                                                    let total = 0;
                                                    let details = [];

                                                    if (parent && parentRaw > 0) {
                                                        if (!shouldExcludeParent) {
                                                            total += parentDisplay;
                                                            // Display Raw Value (Boxes) in the list for Unit fields (Received, Transfer, etc.), but total uses Pieces
                                                            details.push({ name: 'رئيسي', val: isUnitField ? parentRaw : parentDisplay });
                                                        }
                                                    }

                                                    if (children) {
                                                        children.forEach(c => {
                                                            const v = val(c[field]);
                                                            if (v > 0) {
                                                                total += v;
                                                                details.push({ name: c.productName, val: v });
                                                            }
                                                        });
                                                    }
                                                    // Use the calculated total from breakdowns to ensure match with handleAutoSettle
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

                                                const storedClose = (val(parent?.closeStock) || 0) + (children ? children.reduce((acc, c) => acc + val(c.closeStock), 0) : 0);
                                                const isMatch = Math.abs(net - storedClose) < 0.1;

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
                                                        <td style={{ padding: '6px 8px', fontWeight: 'bold', dir: 'ltr', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <span>{net}</span>
                                                            <span title={`المخزن: ${storedClose}`} style={{
                                                                cursor: 'help',
                                                                fontSize: '12px',
                                                                color: isMatch ? '#16a34a' : '#ef4444',
                                                                display: 'flex', alignItems: 'center', gap: '2px'
                                                            }}>
                                                                {isMatch ? '✅' : '❓'}
                                                                <span style={{ fontSize: '10px', color: 'gray' }}>{storedClose}</span>
                                                            </span>
                                                        </td>
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
