import React, { useState, useEffect } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';
import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
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
        targetBranch: 'current' // 'current' or 'both'
    });

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

    // 2. Fetch Products when City or Type changes
    useEffect(() => {
        const fetchProducts = async () => {
            if (!selectedOrderType) {
                setProducts([]);
                return;
            }

            setLoadingProducts(true);
            try {
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
            const updatesRef = collection(db, "productUpdates");
            const q = query(updatesRef, where("city", "==", city), where("typeId", "==", typeId));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                // Update existing
                const docId = querySnapshot.docs[0].id;
                await updateDoc(doc(db, "productUpdates", docId), {
                    updatedAt: serverTimestamp()
                });
                console.log(`Triggered update for existing doc: ${docId}`);
            } else {
                // Create new
                await addDoc(updatesRef, {
                    city,
                    typeId,
                    updatedAt: serverTimestamp()
                });
                console.log(`Created new update trigger for ${city} - ${typeId}`);
            }
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
                updatedAt: serverTimestamp()
            };

            if (editingProduct) {
                // UPDATE (Single product only)
                const docRef = doc(db, "products", editingProduct.id);
                // Ensure we don't accidentally change city during edit logic unless intended (here we stick to current)
                const updateData = { ...baseData, city: selectedCity };

                await updateDoc(docRef, updateData);

                // Update local state
                setProducts(prev => {
                    const updated = prev.map(p => p.id === editingProduct.id ? { ...p, ...updateData } : p);
                    return updated.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
                });
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
                    }

                    // We need to refresh the list because we added multiple independent docs
                    // (Simplest way to sync UI is to trigger a re-fetch or manually add the one that matches current city)
                    const matchesCurrent = { ...baseData, city: selectedCity, createdAt: new Date() }; // Mock obj for UI
                    setProducts(prev => {
                        const newList = [...prev, matchesCurrent];
                        return newList.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
                    });

                    showNotification('success', "تم إضافة المنتج للفرعين بنجاح");

                } else {
                    // CREATE (Single Branch)
                    const newDocData = { ...baseData, city: selectedCity, createdAt: serverTimestamp() };
                    const docRef = await addDoc(collection(db, "products"), newDocData);

                    setProducts(prev => {
                        const newList = [...prev, { id: docRef.id, ...newDocData }];
                        return newList.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
                    });

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
            setProducts(prev => prev.filter(p => p.id !== productId));

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
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', zIndex: 1000
                }}>
                    <div className="card" style={{ width: '100%', maxWidth: '500px', margin: '1rem' }}>
                        <h3 style={{ marginBottom: '1.5rem', color: 'hsl(var(--color-primary))' }}>
                            {editingProduct ? 'تعديل منتج' : 'إضافة منتج جديد'}
                        </h3>

                        <form onSubmit={handleSave}>
                            <div className="input-group">
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>اسم المنتج</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="input-group">
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>المنتج الأب (الرئيسي)</label>
                                <select
                                    className="input-field"
                                    value={formData.parentProduct || ''}
                                    onChange={e => setFormData({ ...formData, parentProduct: e.target.value })}
                                >
                                    <option value="">-- بدون منتج أب --</option>
                                    {products
                                        .filter(p => p.id !== (editingProduct?.id)) // Prevent self-selection
                                        .map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))
                                    }
                                </select>
                                <small style={{ color: 'hsl(var(--color-text-muted))' }}>
                                    اختر منتجاً ليكون هذا المنتج تابعاً له (فرعي).
                                </small>
                            </div>

                            <div className="input-group">
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>الوحدة (unit)</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    value={formData.unit}
                                    onChange={e => setFormData({ ...formData, unit: e.target.value })}
                                    placeholder="مثال: حبة، كرتون"
                                />
                            </div>

                            <div className="input-group">
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>الوحدة الفرعية (unitF - اختياري)</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    value={formData.unitF}
                                    onChange={e => setFormData({ ...formData, unitF: e.target.value })}
                                />
                            </div>

                            <div className="input-group">
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>ترتيب العرض</label>
                                <input
                                    type="number"
                                    className="input-field"
                                    value={formData.sortOrder}
                                    onChange={e => setFormData({ ...formData, sortOrder: e.target.value })}
                                    placeholder="0"
                                />
                                <small style={{ color: 'hsl(var(--color-text-muted))' }}>
                                    الأرقام الأقل تظهر أولاً
                                </small>
                            </div>

                            {!editingProduct && (
                                <div className="input-group" style={{ backgroundColor: '#f0f9ff', padding: '1rem', borderRadius: '8px', border: '1px solid #bae6fd' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: '#0369a1' }}>خيارات الإضافة</label>
                                    <div style={{ display: 'flex', gap: '1.5rem' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                            <input
                                                type="radio"
                                                name="targetBranch"
                                                value="current"
                                                checked={formData.targetBranch === 'current'}
                                                onChange={e => setFormData({ ...formData, targetBranch: e.target.value })}
                                            />
                                            <span>الفرع الحالي فقط ({selectedCity === 'ryad' ? 'الرياض' : 'خارج الرياض'})</span>
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                            <input
                                                type="radio"
                                                name="targetBranch"
                                                value="both"
                                                checked={formData.targetBranch === 'both'}
                                                onChange={e => setFormData({ ...formData, targetBranch: e.target.value })}
                                            />
                                            <span>كلا الفرعين (عام)</span>
                                        </label>
                                    </div>
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>حفظ</button>
                                <button
                                    type="button"
                                    onClick={handleCloseModal}
                                    className="btn"
                                    style={{ flex: 1, backgroundColor: '#f1f5f9', color: '#64748b' }}
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
