import { Queue } from "bullmq";
import { redisConnection } from "./connection";

// Cada fase adiciona sua fila aqui conforme os jobs forem implementados:
// Fase 1: ingestion-queue · Fase 2: caption-queue · Fase 3: render-queue · Fase 4: approval-queue
export const ingestionQueue = new Queue("ingestion", { connection: redisConnection });
export const captionQueue = new Queue("caption", { connection: redisConnection });
export const renderQueue = new Queue("render", { connection: redisConnection });
export const publishQueue = new Queue("publish", { connection: redisConnection });
