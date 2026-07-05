import multer from "multer";
import path from "path";

const imageStorage = multer.memoryStorage();

const imageFilter = (req, file, cb) => {

    if (file.mimetype.startsWith("image/")) {
        cb(null, true);
    } else {
        cb(new Error("Only image files are allowed"), false);
    }

};

const uploadImage = multer({
    storage: imageStorage,
    fileFilter: imageFilter,
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
});

const uploadSingleImage = uploadImage.single("profileImage");

const storage = multer.diskStorage({
    destination(req, file, cb) {
        cb(null, "uploads/");
    },
    filename(req, file, cb) {
        const ext=path.extname(file.originalname);
        
        const sessionId=req.params.id || 'unknown';
        cb(null, `${sessionId}-${Date.now()}${ext}`);
    },
}); 

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith("audio/") || file.mimetype === "application/octet-stream") {
        cb(null, true);
    } else {
        cb(new Error("Not an audio file"), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 1024 * 1024 * 10 },
});

const uploadSingleAudio = upload.single("audioFile");

export { uploadSingleAudio, uploadSingleImage };