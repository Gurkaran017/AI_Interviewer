import express from "express";
import { registerUser, loginUser, googleLogin,getUserProfile, updateUserProfile   } from "../controllers/userController.js";
import { protect } from "../middleware/authMiddleware.js";
import { uploadSingleImage } from "../middleware/uploadMiddleware.js";

const router =express.Router();

router.post("/register",registerUser);
router.post("/login",loginUser);
router.post("/google",googleLogin);
router
.route("/profile")
.get(protect, getUserProfile)
.put(
    protect,
    uploadSingleImage,
    updateUserProfile
);

export default router;