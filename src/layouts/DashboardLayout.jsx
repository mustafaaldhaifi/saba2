import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { logoutUser } from '../features/auth/authService';
import { auth } from '../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';

/**
 * Render the dashboard shell and navigate between its existing sections.
 * 1. Track sidebar state and the current location.
 * 2. Build role-specific navigation, including the constraint subitems.
 * 3. Render the sidebar and page content.
 */
const DashboardLayout = ({ children, title, role }) => {
    // STEP 1: Track sidebar state and location.
    const navigate = useNavigate();
    const location = useLocation();
    const constraintLocationKey = location.pathname + location.search;
    const isConstraintsLocation = location.pathname === '/admin' && new URLSearchParams(location.search).get('tab') === 'constraints';
    const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Mobile state
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false); // Desktop state
    const [constraintsMenuState, setConstraintsMenuState] = useState({ locationKey: constraintLocationKey, expanded: isConstraintsLocation });
    // NOTE: A location change restores the menu's default state without an extra render.
    const isConstraintsExpanded = constraintsMenuState.locationKey === constraintLocationKey
        ? constraintsMenuState.expanded : isConstraintsLocation;
    const [userName, setUserName] = useState('');
    const [userCity, setUserCity] = useState(''); // New state for city

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => { // Made async
            if (user) {
                // Extract name from "name@saba321.com"
                const email = user.email;
                if (email) {
                    const namePart = email.split('@')[0];
                    // Determine display name
                    if (namePart === 'admin') {
                        setUserName('Admin');
                        setUserCity('');
                    } else {
                        setUserName(namePart);

                        // 1. Try Local Storage Cache First
                        const cachedBranch = localStorage.getItem('currentBranch');
                        let cityFound = false;

                        if (cachedBranch) {
                            try {
                                const parsedBranch = JSON.parse(cachedBranch);
                                // Verify it matches current user to avoid stale data
                                if (parsedBranch.name === namePart || parsedBranch.id === namePart) {
                                    console.log("Using cached branch data:", parsedBranch);
                                    setUserCity(parsedBranch.city || '');
                                    cityFound = true;
                                }
                            } catch (e) {
                                console.error("Error parsing cached branch:", e);
                            }
                        }

                        // 2. Fallback to Firestore if not found in cache
                        if (!cityFound) {
                            console.warn("City not found in cache. Accessing as 'other' default.");
                            // Strictly NO server fetch as requested.
                            setUserCity('');
                        }
                    }
                }
            } else {
                // Not logged in
                setUserName('');
                setUserCity('');
                localStorage.removeItem('currentBranch'); // Clear cache on logout/no user
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

    // STEP 2: Keep both constraint sections under the existing sidebar item.
    const menuItems = role === 'admin' ? [
        { label: 'الاستبيانات', path: '/admin/surveys', icon: '📝' },
        { label: 'الرئيسية', path: '/admin', icon: '🏠' },
        { label: 'إدارة المنتجات', path: '/admin?tab=products', icon: '📦' },
        { label: 'القيود', path: '/admin?tab=constraints', icon: '🔒', children: [
            { label: 'قيود المنتجات', path: '/admin?tab=constraints&section=products', icon: '📦', section: 'products' },
            { label: 'قيود طلبيات وجرد', path: '/admin?tab=constraints&section=orders', icon: '📋', section: 'orders' }
        ] },
        { label: 'التقارير', path: '/admin?tab=reports', icon: '📊' },
        { label: 'الفروع', path: '/admin/branches', icon: '🏢' },
        { label: 'الإعدادات', path: '/admin/settings', icon: '⚙️' },
    ] : [
        { label: 'الرئيسية', path: '/branch', icon: '🏠' },
        { label: 'الطلبات', path: '/branch/orders', icon: '📦' },
    ];

    const isItemActive = (item) => {
        if (item.children) return isConstraintsLocation;
        if (item.section) {
            const params = new URLSearchParams(location.search);
            return isConstraintsLocation && (params.get('section') || 'products') === item.section;
        }
        if (item.path.includes('?')) {
            return location.pathname + location.search === item.path;
        }
        if (item.path === '/admin') {
            return location.pathname === '/admin' && !location.search;
        }
        return location.pathname === item.path;
    };

    // STEP 3: Render the navigation and current page.
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

                <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.5rem 0.5rem' }}>
                    <ul style={{ listStyle: 'none' }}>
                        {menuItems.map((item, index) => {
                            const active = isItemActive(item);
                            return (
                            <li key={index} style={{ marginBottom: '0.5rem' }}>
                                <button
                                    className="sidebar-link"
                                    onClick={() => {
                                        if (item.children) {
                                            setIsSidebarCollapsed(false);
                                            setConstraintsMenuState({ locationKey: constraintLocationKey, expanded: !isConstraintsExpanded });
                                            return;
                                        }
                                        navigate(item.path);
                                        setIsSidebarOpen(false); // Close on selection (mobile)
                                    }}
                                    title={item.label}
                                    aria-expanded={item.children ? isConstraintsExpanded : undefined}
                                    aria-controls={item.children && isConstraintsExpanded ? 'constraints-submenu' : undefined}
                                    style={{
                                        width: '100%',
                                        textAlign: 'right',
                                        padding: '0.75rem 1rem',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        backgroundColor: active ? 'hsl(var(--color-primary) / 0.1)' : 'transparent',
                                        color: active ? 'hsl(var(--color-primary))' : 'hsl(var(--color-text-main))',
                                        fontWeight: active ? '600' : '400',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.75rem'
                                    }}
                                >
                                    <span style={{ fontSize: '1.2rem' }}>{item.icon}</span>
                                    <span className="sidebar-link-text" style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
                                    {item.children && <span className="sidebar-link-text" aria-hidden="true" style={{ marginRight: 'auto' }}>{isConstraintsExpanded ? '▴' : '▾'}</span>}
                                </button>
                                {item.children && isConstraintsExpanded && (
                                    <ul id="constraints-submenu" className="sidebar-submenu">
                                        {item.children.map(child => (
                                            <li key={child.section}>
                                                <button type="button" className={`sidebar-submenu-link ${isItemActive(child) ? 'is-active' : ''}`} onClick={() => {
                                                    navigate(child.path);
                                                    setIsSidebarOpen(false);
                                                }}>
                                                    <span aria-hidden="true">{child.icon}</span>
                                                    <span>{child.label}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </li>
                            );
                        })}
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
                        {/* Version Badge */}
                        <div style={{
                            fontSize: '0.75rem',
                            color: '#64748b',
                            backgroundColor: '#f1f5f9',
                            padding: '0.25rem 0.5rem',
                            borderRadius: '12px',
                            border: '1px solid #e2e8f0'
                        }}>
                            v2.8
                        </div>

                        {/* Use Name Display */}
                        <div style={{ textAlign: 'right' }}>
                            {userName && (
                                <div style={{ fontWeight: '600', color: 'hsl(var(--color-primary))', fontSize: '0.95rem' }}>
                                    {userName}
                                </div>
                            )}
                            {userCity && (
                                <div style={{ fontSize: '0.8rem', color: 'hsl(var(--color-text-muted))' }}>
                                    {userCity}
                                </div>
                            )}
                        </div>

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
