import React, { useState, useEffect } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { db, auth } from '../../config/firebase';
import { onAuthStateChanged } from "firebase/auth";

const BranchDashboard = () => {
    const [selectedOrderType, setSelectedOrderType] = useState('');
    const [orderTypes, setOrderTypes] = useState([]);
    const [products, setProducts] = useState([]);
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [branchData, setBranchData] = useState(null);

    // 1. Fetch Branch Data (for City) & Order Types on Mount
    useEffect(() => {
        const fetchData = async () => {
            // Get Current User
            const user = auth.currentUser;
            if (user) {
                // Assume email is "branchName@saba321.com"
                // We need to find the branch document.
                // Option A: Query branches where name == email prefix
                // Option B: Query branches where email == user.email (if we stored it)
                // Let's try Option A as per my Login logic.
                const namePart = user.email.split('@')[0];

                // Allow for "admin" to see everything or force a mock city? 
                // If admin, maybe let them choose city? For now, simplistic approach.
                if (namePart !== 'admin') {
                    const q = query(collection(db, "branches"), where("name", "==", namePart));
                    const querySnapshot = await getDocs(q);
                    if (!querySnapshot.empty) {
                        setBranchData(querySnapshot.docs[0].data());
                    }
                }
            }

            // Fetch Order Types (Categories)
            // I will assume the collection is named 'types' based on 'typeId' field in products.
            try {
                const typesSnapshot = await getDocs(collection(db, "types")); // or "categories"
                const typesList = typesSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setOrderTypes(typesList);
            } catch (error) {
                console.error("Error fetching types:", error);
            }
        };

        fetchData();
    }, []);

    // 2. Fetch Products when Order Type changes
    useEffect(() => {
        const fetchProducts = async () => {
            if (!selectedOrderType || !branchData) return;

            setLoadingProducts(true);
            try {
                // Query: typeId == selectedOrderType AND city == branchData.city
                // User said "city" values are "others" (الرياض وخارجها means 'Riyadh' and 'others'?)
                // Check branchData.city.

                const productsRef = collection(db, "products");
                const q = query(
                    productsRef,
                    where("typeId", "==", selectedOrderType),
                    where("city", "==", branchData.city)
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
            {/* ... Render Dropdown with orderTypes ... */}
            {/* ... Render Products Grid/Table ... */}
        </DashboardLayout>
    );
};
