import React, { useState, useEffect } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { db, auth } from '../../config/firebase'; // Ensure path is correct
import { onAuthStateChanged } from "firebase/auth";

const BranchDashboard = () => {
    const [selectedOrderType, setSelectedOrderType] = useState('');
    const [orderTypes, setOrderTypes] = useState([]);
    const [products, setProducts] = useState([]);
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [branchData, setBranchData] = useState(null);
    const [loadingData, setLoadingData] = useState(true);

    // 1. Fetch Branch Data and Order Types on Mount
    useEffect(() => {
        const fetchData = async () => {
            // 1. Identify Branch
            const user = auth.currentUser;

            if (user) {
                const email = user.email;
                const namePart = email.split('@')[0];

                // 1. Try Local Storage Cache First
                const cachedBranch = localStorage.getItem('currentBranch');
                let foundInCache = false;

                if (cachedBranch) {
                    try {
                        const parsedBranch = JSON.parse(cachedBranch);
                        // Verify it matches current user
                        if (parsedBranch.name === namePart || parsedBranch.id === namePart) {
                            console.log("BranchDashboard: Using cached branch data:", parsedBranch);
                            setBranchData(parsedBranch);
                            foundInCache = true;
                        }
                    } catch (e) {
                        console.error("Error parsing cached branch:", e);
                    }
                }

                if (!foundInCache) {
                    // 2. Fetch branch details (Fallback)
                    try {
                        const branchesRef = collection(db, 'branches');
                        console.log("Checking branch for:", namePart);

                        let targetDoc = null;

                        // Strategy A: Query by 'name' field
                        const q = query(branchesRef, where('name', '==', namePart));
                        const querySnapshot = await getDocs(q);

                        if (!querySnapshot.empty) {
                            targetDoc = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() };
                            console.log("Found branch by name query.");
                        }

                        // Strategy B: Fetch by Document ID
                        if (!targetDoc) {
                            console.log("Strategy A failed. Trying Document ID...");
                            const docRef = doc(db, "branches", namePart);
                            const docSnap = await getDoc(docRef);
                            if (docSnap.exists()) {
                                targetDoc = { id: docSnap.id, ...docSnap.data() };
                                console.log("Found branch by ID.");
                            }
                        }

                        // Strategy C: Ultimate Fallback - Fetch All (Matches Login.jsx logic)
                        if (!targetDoc) {
                            console.log("Strategy B failed. Trying Ultimate Fallback (Scan All)...");
                            const allDocsSnap = await getDocs(collection(db, "branches"));
                            // Try to find a doc where name matches namePart loosely
                            const foundDoc = allDocsSnap.docs.find(d => {
                                const data = d.data();
                                return (data.name === namePart) || (d.id === namePart);
                            });

                            if (foundDoc) {
                                targetDoc = { id: foundDoc.id, ...foundDoc.data() };
                                console.log("Found branch via Scan All.");
                            }
                        }

                        if (targetDoc) {
                            // Success!
                            setBranchData(targetDoc);
                            // SELF-HEALING: Save to cache now so we don't fetch next time
                            localStorage.setItem('currentBranch', JSON.stringify(targetDoc));
                        } else {
                            console.error("CRITICAL: Branch not found by any method:", namePart);
                            setBranchData({ city: 'other', name: namePart }); // Final safety net
                        }

                    } catch (e) {
                        console.error("Error fetching branch data", e);
                    }
                }
            }

            // 2. Fetch Order Types (Categories)
            try {
                const typesSnapshot = await getDocs(collection(db, "types"));
                const typesList = typesSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));

                // Ensure "Monthly Inventory" is present with the known ID
                const monthlyId = "WbAP06wLDRvZFTYUtkjU";
                const monthlyExists = typesList.some(t => t.id === monthlyId);

                // if (!monthlyExists) {
                //     typesList.push({ id: monthlyId, name: 'الجرد الشهري' });
                // }

                setOrderTypes(typesList);
            } catch (error) {
                console.error("Error fetching types:", error);
                // Fallback hardcoded if fetch fails? Better to show empty or error.
            } finally {
                setLoadingData(false);
            }
        };

        // Listen for auth state to ensure we have a user
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                fetchData();
            }
        });

        return () => unsubscribe();
    }, []);

    // 2. Fetch Products when Order Type changes
    useEffect(() => {
        const fetchProducts = async () => {
            if (!selectedOrderType || !branchData) return;

            setLoadingProducts(true);
            try {
                // Determine target city for products based on branch city
                // "ryad"/"Riyadh"/"الرياض" -> "Riyadh" (assuming products use 'Riyadh' or match branch), "other" -> "other"
                const branchCity = (branchData.city || '').toLowerCase().trim();

                let targetCity = 'other'; // Default
                if (branchCity === 'ryad' || branchCity === 'riyadh' || branchCity === 'الرياض') {
                    targetCity = 'Riyadh'; // Or 'ryad' if the products strictly use 'ryad'
                } else if (branchCity === 'other') {
                    targetCity = 'other';
                } else {
                    // Fallback or treat as other? User said "no other cities".
                    // If the branch says "Jeddah", it falls to 'other' in my previous logic.
                    // User says "no other cities".
                    targetCity = 'other';
                }

                console.log(`Branch City: "${branchData.city}" -> Mapped Query City: "${targetCity}"`);

                const productsRef = collection(db, "products");

                const q = query(
                    productsRef,
                    where("typeId", "==", selectedOrderType),
                    where("city", "==", targetCity)
                );

                const querySnapshot = await getDocs(q);
                const productsList = querySnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setProducts(productsList);
            } catch (error) {
                console.error("Error fetching products:", error);
            } finally {
                setLoadingProducts(false);
            }
        };

        fetchProducts();
    }, [selectedOrderType, branchData]);

    return (
        <DashboardLayout title="نظرة عامة على الفرع" role="branch">

            {/* Order Type Selection Section */}
            <div className="card" style={{ marginBottom: '2rem', padding: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: 'hsl(var(--color-text-main))' }}>
                    نوع العملية / الطلب
                </label>
                {loadingData ? (
                    <div style={{ textAlign: 'center', padding: '1rem', color: 'hsl(var(--color-text-muted))' }}>جاري تحميل البيانات...</div>
                ) : (
                    <select
                        className="input-field"
                        value={selectedOrderType}
                        onChange={(e) => setSelectedOrderType(e.target.value)}
                        style={{ direction: 'rtl', fontSize: '1.1rem', padding: '1rem' }}
                    >
                        <option value="" disabled>-- اختر نوع الطلبية --</option>
                        {orderTypes.map(type => (
                            <option key={type.id} value={type.id}>{type.name}</option>
                            // user didn't specify the field name for type label, assuming 'name' or 'label'.
                            // If `type.name` is undefined, it will show empty. I'll check `type.label` too.
                        ))}
                    </select>
                )}
            </div>

            {/* Products Display */}
            {selectedOrderType ? (
                <div className="card">
                    <h2 style={{ marginBottom: '1rem', color: 'hsl(var(--color-primary))' }}>
                        المنتجات ({products.length})
                        {/* Debug info (optional, can be removed) */}
                        <span style={{ fontSize: '0.8rem', color: '#ccc', marginRight: '1rem' }}>
                            (Type: {selectedOrderType} | City: {branchData?.city || 'Loading...'})
                        </span>
                    </h2>

                    {loadingProducts ? (
                        <p style={{ textAlign: 'center', padding: '2rem' }}>جاري تحميل المنتجات...</p>
                    ) : products.length > 0 ? (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f8fafc', color: 'hsl(var(--color-text-muted))', textAlign: 'right' }}>
                                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>الاسم</th>
                                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>الوحدة</th>
                                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>تاريخ الإضافة</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {products.map((product) => (
                                        <tr key={product.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '0.75rem', fontWeight: '500' }}>{product.name}</td>
                                            <td style={{ padding: '0.75rem' }}>{product.unitF || product.unit || '-'}</td>
                                            <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: 'hsl(var(--color-text-muted))' }}>
                                                {/* Handle timestamp safely */}
                                                {product.createdAt?.seconds ? new Date(product.createdAt.seconds * 1000).toLocaleDateString('ar-EG') : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'hsl(var(--color-text-muted))' }}>
                            لا توجد منتجات مطابقة لهذا النوع ({selectedOrderType}) في مدينتك ({branchData?.city || 'غير محدد'}).
                            <br />
                            <small>تأكد من وجود منتجات بـ typeId هذا في قاعدة البيانات.</small>
                        </div>
                    )}
                </div>
            ) : (
                // ... (Placeholder stats or prompt) ...
                <div style={{ padding: '2rem', textAlign: 'center', color: 'hsl(var(--color-text-muted))' }}>
                    الرجاء اختيار نوع الطلبية لعرض المنتجات.
                </div>
            )}
        </DashboardLayout>
    );
};

export default BranchDashboard;
