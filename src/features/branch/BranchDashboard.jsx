import React, { useState } from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';

const BranchDashboard = () => {
    const [selectedOrderType, setSelectedOrderType] = useState('');

    const orderTypes = [
        { id: 'daily_inventory', label: 'الجرد اليومي' },
        { id: 'direct_supply', label: 'طلبية التوريد المباشر' },
        { id: 'vegetable_order', label: 'طلبية الخضار' },
        { id: 'monthly_inventory', label: 'الجرد الشهري' },
 

        { id: 'warehouse_order', label: 'طلبية المستودع' },
        { id: 'spices_order', label: 'طلبية البهارات' },
    ];

    return (
        <DashboardLayout title="نظرة عامة على الفرع" role="branch">

            {/* Order Type Selection Section */}
            <div className="card" style={{ marginBottom: '2rem', padding: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: 'hsl(var(--color-text-main))' }}>
                    نوع العملية / الطلب
                </label>
                <select
                    className="input-field"
                    value={selectedOrderType}
                    onChange={(e) => setSelectedOrderType(e.target.value)}
                    style={{ direction: 'rtl', fontSize: '1.1rem', padding: '1rem' }}
                >
                    <option value="" disabled>-- اختر نوع الطلبية --</option>
                    {orderTypes.map(type => (
                        <option key={type.id} value={type.id}>{type.label}</option>
                    ))}
                </select>
            </div>

            {/* Content Area Based on Selection */}
            {selectedOrderType ? (
                <div className="card">
                    <h2 style={{ marginBottom: '1rem', color: 'hsl(var(--color-primary))' }}>
                        {orderTypes.find(t => t.id === selectedOrderType)?.label}
                    </h2>
                    <p style={{ color: 'hsl(var(--color-text-muted))' }}>
                        نموذج إدخال البيانات الخاص بـ {orderTypes.find(t => t.id === selectedOrderType)?.label} سيظهر هنا.
                    </p>
                    {/* Placeholder for future form components */}
                    <div style={{ padding: '2rem', border: '2px dashed #e2e8f0', borderRadius: 'var(--radius-md)', textAlign: 'center', marginTop: '1rem' }}>
                        محتوى النموذج...
                    </div>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
                    {/* Stat Card 1 */}
                    <div className="card">
                        <span style={{ fontSize: '0.85rem', color: 'hsl(var(--color-text-muted))', display: 'block', marginBottom: '0.5rem' }}>طلبات اليوم</span>
                        <div style={{ fontSize: '2rem', fontWeight: '700', color: 'hsl(var(--color-primary))' }}>12</div>
                    </div>

                    {/* Stat Card 2 */}
                    <div className="card">
                        <span style={{ fontSize: '0.85rem', color: 'hsl(var(--color-text-muted))', display: 'block', marginBottom: '0.5rem' }}>قيد التجهيز</span>
                        <div style={{ fontSize: '2rem', fontWeight: '700', color: '#f59e0b' }}>3</div>
                    </div>

                    <div className="card" style={{ gridColumn: '1 / -1' }}>
                        <p style={{ textAlign: 'center', color: 'hsl(var(--color-text-muted))' }}>
                            الرجاء اختيار نوع الطلبية من القائمة أعلاه للبدء.
                        </p>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
};

export default BranchDashboard;
