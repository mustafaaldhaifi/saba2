import { signOut } from "firebase/auth";
import { auth } from "../../config/firebase";

export const logoutUser = async () => {
    try {
        await signOut(auth);
        return { success: true };
    } catch (error) {
        console.error("Logout Error:", error);
        return { success: false, error: error.message };
    }
};
