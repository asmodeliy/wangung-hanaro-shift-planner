import { parentPort, workerData } from 'node:worker_threads'
import { generateSchedule } from './planner.js'
try { parentPort.postMessage(await generateSchedule(workerData)) }
catch (error) { parentPort.postMessage({ error: `자동편성을 처리하지 못했습니다: ${error.message}` }) }
