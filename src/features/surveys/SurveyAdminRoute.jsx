import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { Navigate } from 'react-router-dom';
import { auth } from '../../config/firebase';

const SurveyAdminRoute = ({ children }) => {
  const [user, setUser] = useState(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  if (user === undefined) return <div className="page-center">جاري التحقق من الحساب...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.email?.toLowerCase() !== 'admin@saba321.com') return <Navigate to="/branch" replace />;
  return children;
};

export default SurveyAdminRoute;
