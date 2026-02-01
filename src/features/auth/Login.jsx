import React, { useState, useEffect } from 'react';
import { signInWithEmailAndPassword } from "firebase/auth";
import { getDocs, collection } from "firebase/firestore";
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../config/firebase';

const Login = () => {
    const [branches, setBranches] = useState([]);
    const [selectedBranch, setSelectedBranch] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [fetchingBranches, setFetchingBranches] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchBranches = async () => {
            try {
                const querySnapshot = await getDocs(collection(db, "branches"));
                const branchList = querySnapshot.docs.map(doc => ({
                    id: doc.id,
                    name: doc.data().name || doc.id, // Ensure we have a name
                    displayName: doc.data().name || doc.id
                }));

                // Add Admin Option manually
                const adminOption = { id: 'admin', name: 'admin', displayName: 'الإدارة (Admin)' };

                // Combine: Admin first, then branches
                setBranches([adminOption, ...branchList]);

            } catch (err) {
                console.error("Error fetching branches:", err);
                setError("فشل في تحميل قائمة الفروع");
                // Even on error, show Admin option so admin can login
                setBranches([{ id: 'admin', name: 'admin', displayName: 'الإدارة (Admin)' }]);
            } finally {
                setFetchingBranches(false);
            }
        };

        fetchBranches();
    }, []);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        if (!selectedBranch) {
            setError('الرجاء اختيار الفرع');
            setLoading(false);
            return;
        }

        // Email construction logic
        const email = `${selectedBranch}@saba321.com`;

        try {
            await signInWithEmailAndPassword(auth, email, password);
            // Logic to determine if Admin or Branch
            if (email.includes('admin')) {
                navigate('/admin');
            } else {
                navigate('/branch');
            }
        } catch (err) {
            console.error(err);
            setError('فشل تسجيل الدخول: تأكد من كلمة المرور');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="page-center">
            <div className="card login-card" style={{ maxWidth: '400px', width: '100%', padding: '2.5rem' }}>
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        backgroundColor: 'hsl(var(--color-primary) / 0.1)',
                        color: 'hsl(var(--color-primary))',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 1rem',
                        fontSize: '1.75rem'
                    }}>
                        🔐
                    </div>
                    <h2 style={{ color: 'hsl(var(--color-primary))', fontWeight: '800' }}>تسجيل الدخول</h2>
                    <p style={{ color: 'hsl(var(--color-text-muted))', fontSize: '0.9rem' }}>نظام سبأ لإدارة الفروع</p>
                </div>

                {error && (
                    <div style={{
                        color: '#b91c1c',
                        marginBottom: '1.5rem',
                        textAlign: 'center',
                        backgroundColor: '#fef2f2',
                        padding: '0.75rem',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid #fecaca',
                        fontSize: '0.9rem'
                    }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleLogin}>
                    <div className="input-group">
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '500' }}>الجهة / الفرع</label>
                        {fetchingBranches ? (
                            <div className="input-field" style={{ color: 'hsl(var(--color-text-muted))', textAlign: 'center', backgroundColor: '#f8fafc' }}>
                                جاري التحميل...
                            </div>
                        ) : (
                            <div style={{ position: 'relative' }}>
                                <select
                                    className="input-field"
                                    value={selectedBranch}
                                    onChange={(e) => setSelectedBranch(e.target.value)}
                                    required
                                    style={{
                                        direction: 'rtl',
                                        appearance: 'none',
                                        backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23007CB2%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`,
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'left 0.7rem top 50%',
                                        backgroundSize: '0.65rem auto',
                                        paddingLeft: '2rem'
                                    }}
                                >
                                    <option value="" disabled>-- اختر الحساب --</option>
                                    {branches.map((branch) => (
                                        <option key={branch.id} value={branch.name}>
                                            {branch.displayName}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    <div className="input-group">
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '500' }}>كلمة المرور</label>
                        <input
                            type="password"
                            className="input-field"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            placeholder="••••••••"
                        />
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: '1.5rem', padding: '0.875rem' }}
                        disabled={loading || fetchingBranches}
                    >
                        {loading ? 'جاري التحميل...' : 'تسجيل الدخول'}
                    </button>

                </form>
            </div>
        </div>
    );
};

export default Login;
