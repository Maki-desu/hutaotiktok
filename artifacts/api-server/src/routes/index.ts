import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tiktokRouter from "./tiktok";
import announcementsRouter from "./announcements";
import adminRouter from "./admin";
import monitoredAccountsRouter from "./monitored_accounts";
import notificationsRouter from "./notifications";
import downloadsRouter from "./downloads";
import proxyRouter from "./proxy";
import uploadRouter from "./upload";
import showcaseRouter from "./showcase";
import redirectRouter from "./redirect";
import youtubeRouter from "./youtube";
import facebookRouter from "./facebook";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tiktokRouter);
router.use(announcementsRouter);
router.use(adminRouter);
router.use(monitoredAccountsRouter);
router.use(notificationsRouter);
router.use(downloadsRouter);
router.use(proxyRouter);
router.use(uploadRouter);
router.use(showcaseRouter);
router.use(redirectRouter);
router.use(youtubeRouter);
router.use(facebookRouter);

export default router;
