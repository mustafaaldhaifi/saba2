import React, { useState, useEffect } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';
import { collection, query, where, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from '../../config/firebase';

const AdminDashboard = () => {
    // Filters
    const [selectedCity, setSelectedCity] = useState('ryad'); // Default to ryad
    const [selectedOrderType, setSelectedOrderType] = useState('');

    // Data
    const [orderTypes, setOrderTypes] = useState([]);
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

    // 1. Fetch Order Types on Mount
    useEffect(() => {
        const fetchTypes = async () => {
            try {
                const typesSnapshot = await getDocs(collection(db, "types"));
                const typesList = typesSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));

                // Ensure Monthly Inventory exists
                const monthlyId = "WbAP06wLDRvZFTYUtkjU";
                if (!typesList.some(t => t.id === monthlyId)) {
                    typesList.push({ id: monthlyId, name: 'الجرد الشهري' });
                }

                setOrderTypes(typesList);

                // Select first type by default if available
                if (typesList.length > 0 && !selectedOrderType) {
                    // setSelectedOrderType(typesList[0].id); // Optional: Auto-select
                }
            } catch (error) {
                console.error("Error fetching types:", error);
            }
        };
        fetchTypes();
    }, []);

    // 2. Fetch Products (Smart Caching)
    useEffect(() => {
        const fetchProducts = async () => {
            if (!selectedOrderType) {
                setProducts([]);
                return;
            }

            const cacheKey = `products_${selectedCity}_${selectedOrderType}`;
            const cachedDataString = localStorage.getItem(cacheKey);
            let cachedData = null;

            // 1. Try Load Local
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

            // If no cache, we must show loading
            if (!cachedData) {
                setLoadingProducts(true);
            }

            try {
                // 2. Check ProductUpdates from Server
                const updatesRef = collection(db, "productUpdates");
                const qUpdate = query(updatesRef, where("city", "==", selectedCity), where("typeId", "==", selectedOrderType));
                const updateSnap = await getDocs(qUpdate);

                let serverValues = null;
                if (!updateSnap.empty) {
                    serverValues = updateSnap.docs[0].data();
                }

                const serverLastUpdate = serverValues?.updatedAt?.toMillis() || 0;
                const localLastSync = cachedData?.lastSync || 0;

                // 3. Decide: Fetch if No Cache OR Server is Newer
                if (!cachedData || serverLastUpdate > localLastSync) {
                    console.log("Fetching fresh data from server...");
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

                    // Client-side sort
                    items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

                    setProducts(items);

                    // 4. Update Cache
                    localStorage.setItem(cacheKey, JSON.stringify({
                        items: items,
                        lastSync: Date.now()
                    }));
                } else {
                    console.log("Cache is up to date.");
                }

            } catch (error) {
                console.error("Error fetching admin products:", error);
            } finally {
                setLoadingProducts(false);
            }
        };

        fetchProducts();
    }, [selectedCity, selectedOrderType]);


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

    return (
        <DashboardLayout title="إدارة المنتجات" role="admin">

            {/* Filters Section */}
            <div className="card" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>

                    {/* City Select */}
                    <div className="input-group" style={{ marginBottom: 0 }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>المدينة</label>
                        <select
                            className="input-field"
                            value={selectedCity}
                            onChange={(e) => setSelectedCity(e.target.value)}
                        >
                            <option value="ryad">الرياض (Riyadh)</option>
                            <option value="other">خارج الرياض (Outside Riyadh)</option>
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
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                            <thead>
                                <tr style={{ backgroundColor: '#f8fafc', color: 'hsl(var(--color-text-muted))', textAlign: 'right' }}>
                                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>الاسم</th>
                                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>المنتج الأب</th>
                                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>الترتيب</th>
                                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>الوحدة</th>
                                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>إجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                {products.map((product) => {
                                    // Helper to find parent name
                                    const parentName = product.parentProduct
                                        ? products.find(p => p.id === product.parentProduct)?.name || 'غير موجود'
                                        : '-';

                                    return (
                                        <tr key={product.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '0.75rem', fontWeight: '500' }}>{product.name}</td>
                                            <td style={{ padding: '0.75rem', color: 'hsl(var(--color-primary))', fontSize: '0.9rem' }}>{parentName}</td>
                                            <td style={{ padding: '0.75rem' }}>{product.sortOrder || 0}</td>
                                            <td style={{ padding: '0.75rem' }}>{product.unitF || product.unit || '-'}</td>
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
                        </form>
                    </div>
                </div>
            )}

            {/* Notification Toast */}
            {notification && (
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
            )}

            {/* Loading Overlay */}
            {isSubmitting && (
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
            )}

        </DashboardLayout>
    );
};

export default AdminDashboard;
