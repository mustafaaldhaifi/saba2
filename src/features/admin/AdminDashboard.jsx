import React from 'react';
import DashboardLayout from '../../layouts/DashboardLayout';

const AdminDashboard = () => {
    return (
        <DashboardLayout title="لوحة القيادة" role="admin">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
                {/* Stat Card 1 */}
                <div className="card">
                    <span style={{ fontSize: '0.85rem', color: 'hsl(var(--color-text-muted))', display: 'block', marginBottom: '0.5rem' }}>إجمالي المبيعات</span>
                    <div style={{ fontSize: '2rem', fontWeight: '700', color: 'hsl(var(--color-primary))' }}>$24,500</div>
                    <div style={{ fontSize: '0.85rem', color: '#10b981', marginTop: '0.5rem' }}>+12% عن الشهر الماضي</div>
                </div>

                {/* Stat Card 2 */}
                <div className="card">
                    <span style={{ fontSize: '0.85rem', color: 'hsl(var(--color-text-muted))', display: 'block', marginBottom: '0.5rem' }}>الطلبات النشطة</span>
                    <div style={{ fontSize: '2rem', fontWeight: '700', color: 'hsl(var(--color-primary))' }}>45</div>
                    <div style={{ fontSize: '0.85rem', color: 'hsl(var(--color-text-muted))', marginTop: '0.5rem' }}>لليوم الحالي</div>
                </div>

                {/* Stat Card 3 */}
                <div className="card">
                    <span style={{ fontSize: '0.85rem', color: 'hsl(var(--color-text-muted))', display: 'block', marginBottom: '0.5rem' }}>الفروع المتصلة</span>
                    <div style={{ fontSize: '2rem', fontWeight: '700', color: 'hsl(var(--color-primary))' }}>8</div>
                    <div style={{ fontSize: '0.85rem', color: '#10b981', marginTop: '0.5rem' }}>كل الأنظمة تعمل</div>
                </div>
            </div>

            <div className="card" style={{ marginTop: '2rem' }}>
                <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>أحدث النشاطات</h3>
                <p style={{ color: 'hsl(var(--color-text-muted))' }}>لا توجد نشاطات حديثة لعرضها حالياً.</p>
            </div>
        </DashboardLayout>
    );
};

export default AdminDashboard;
