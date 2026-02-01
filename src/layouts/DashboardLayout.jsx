import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { logoutUser } from '../features/auth/authService';
import { auth } from '../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';

const DashboardLayout = ({ children, title, role }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Mobile state
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false); // Desktop state
    const [userName, setUserName] = useState('');

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                // Extract name from "name@saba321.com"
                const email = user.email;
                if (email) {
                    const namePart = email.split('@')[0];
                    // Determine display name
                    if (namePart === 'admin') {
                        setUserName('Admin');
                    } else {
                        setUserName(namePart);
                    }
                }
            } else {
                // Not logged in
                setUserName('');
            }
        });

        return () => unsubscribe();
    }, []);

    const handleLogout = async () => {
        if (window.confirm('هل أنت متأكد أنك تريد تسجيل الخروج؟')) {
            await logoutUser();
            navigate('/login');
        }
    };

    const toggleSidebarMobile = () => {
        setIsSidebarOpen(!isSidebarOpen);
    };

    const toggleSidebarDesktop = () => {
        setIsSidebarCollapsed(!isSidebarCollapsed);
    };

    const menuItems = role === 'admin' ? [
        { label: 'الرئيسية', path: '/admin', icon: '🏠' },
        { label: 'الفروع', path: '/admin/branches', icon: '🏢' },
        { label: 'الإعدادات', path: '/admin/settings', icon: '⚙️' },
    ] : [
        { label: 'الرئيسية', path: '/branch', icon: '🏠' },
        { label: 'الطلبات', path: '/branch/orders', icon: '📦' },
    ];

    return (
        <div className="dashboard-container">
            {/* Mobile Overlay */}
            <div
                className={`sidebar-overlay ${isSidebarOpen ? 'open' : ''}`}
                onClick={() => setIsSidebarOpen(false)}
            ></div>

            {/* Sidebar */}
            <aside className={`sidebar ${isSidebarOpen ? 'open' : ''} ${isSidebarCollapsed ? 'collapsed' : ''}`}>

                {/* Desktop Toggle Button */}
                <button className="sidebar-toggle-desktop" onClick={toggleSidebarDesktop}>
                    ➜
                </button>

                <div className="sidebar-header" style={{ padding: '2rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: '89px' }}>
                    <div>
                        <h2 className="sidebar-header-text" style={{ color: 'hsl(var(--color-primary))', fontSize: '1.5rem', fontWeight: '800', whiteSpace: 'nowrap' }}>نظام سبأ</h2>
                        <span className="sidebar-header-text" style={{ fontSize: '0.85rem', color: 'hsl(var(--color-text-muted))', whiteSpace: 'nowrap' }}>
                            {role === 'admin' ? 'لوحة الإدارة' : 'لوحة الفرع'}
                        </span>
                        {isSidebarCollapsed && <h2 style={{ color: 'hsl(var(--color-primary))', fontSize: '1.5rem', fontWeight: '800', margin: 0 }}>S</h2>}
                    </div>
                    {/* Close button for mobile */}
                    <button
                        className="menu-toggle"
                        onClick={() => setIsSidebarOpen(false)}
                        style={{ fontSize: '1.5rem', lineHeight: 1 }}
                    >
                        &times;
                    </button>
                </div>

                <nav style={{ flex: 1, padding: '1.5rem 0.5rem' }}>
                    <ul style={{ listStyle: 'none' }}>
                        {menuItems.map((item, index) => (
                            <li key={index} style={{ marginBottom: '0.5rem' }}>
                                <button
                                    className="sidebar-link"
                                    onClick={() => {
                                        navigate(item.path);
                                        setIsSidebarOpen(false); // Close on selection (mobile)
                                    }}
                                    title={item.label}
                                    style={{
                                        width: '100%',
                                        textAlign: 'right',
                                        padding: '0.75rem 1rem',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        backgroundColor: location.pathname === item.path ? 'hsl(var(--color-primary) / 0.1)' : 'transparent',
                                        color: location.pathname === item.path ? 'hsl(var(--color-primary))' : 'hsl(var(--color-text-main))',
                                        fontWeight: location.pathname === item.path ? '600' : '400',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.75rem'
                                    }}
                                >
                                    <span style={{ fontSize: '1.2rem' }}>{item.icon}</span>
                                    <span className="sidebar-link-text" style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </nav>

                <div style={{ padding: '1.5rem', borderTop: '1px solid #f1f5f9' }}>
                    <button
                        className="sidebar-link"
                        onClick={handleLogout}
                        title="تسجيل خروج"
                        style={{
                            width: '100%',
                            padding: '0.75rem',
                            border: '1px solid hsl(var(--color-danger))',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: 'transparent',
                            color: 'hsl(var(--color-danger))',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem'
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.backgroundColor = 'hsl(var(--color-danger))';
                            e.currentTarget.style.color = 'white';
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = 'hsl(var(--color-danger))';
                        }}
                    >
                        <span>🚪</span>
                        <span className="sidebar-link-text">تسجيل خروج</span>
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className={`main-content ${isSidebarCollapsed ? 'collapsed' : ''}`}>
                <header style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '2rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <button
                            className="menu-toggle"
                            onClick={toggleSidebarMobile}
                            style={{ fontSize: '1.5rem', padding: '0.5rem' }}
                        >
                            &#9776; {/* Hamburger Icon */}
                        </button>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', margin: 0 }}>{title}</h1>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {/* Use Name Display */}
                        {userName && (
                            <span style={{ fontWeight: '600', color: 'hsl(var(--color-primary))', fontSize: '0.95rem' }}>
                                {userName}
                            </span>
                        )}

                        <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            backgroundColor: 'hsl(var(--color-primary))',
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            boxShadow: 'var(--shadow-sm)'
                        }}>
                            {role === 'admin' ? 'A' : 'B'}
                        </div>
                    </div>
                </header>
                {children}
            </main>
        </div>
    );
};

export default DashboardLayout;
