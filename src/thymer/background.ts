// Background side of saving to Thymer: the popup sends the clip here because only
// the background script may call the bridge on localhost without CORS. Clips made
// while Thymer is closed wait in local storage and go in once it answers again.

import browser from '../utils/browser-polyfill';
import { ThymerClient, ThymerUnreachableError } from './client';
import { ThymerClip, ThymerSaver, ThymerSaveResult } from './save';

const QUEUE_KEY = 'thymerQueue';
const RETRY_ALARM = 'thymerQueueRetry';

export type ThymerSaveResponse =
	| { success: true; result: ThymerSaveResult }
	| { success: false; queued: boolean; error: string };

const saver = new ThymerSaver(new ThymerClient());
let flushing: Promise<void> | null = null;

async function readQueue(): Promise<ThymerClip[]> {
	const stored = await browser.storage.local.get(QUEUE_KEY);
	return (stored[QUEUE_KEY] as ThymerClip[] | undefined) || [];
}

async function writeQueue(queue: ThymerClip[]): Promise<void> {
	await browser.storage.local.set({ [QUEUE_KEY]: queue });
	if (queue.length > 0) {
		browser.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
	} else {
		await browser.alarms.clear(RETRY_ALARM);
	}
}

/** Save the clips that were made while Thymer was closed, oldest first. */
export function flushThymerQueue(): Promise<void> {
	flushing ??= (async () => {
		const queue = await readQueue();
		if (queue.length === 0) {
			return;
		}
		while (queue.length > 0) {
			try {
				await saver.save({ ...queue[0], open: false });
			} catch (error) {
				if (error instanceof ThymerUnreachableError) {
					break;
				}
				// Thymer answered but refused this clip; retrying would not help
				console.error('[Thymer] A queued clip was dropped:', error);
			}
			queue.shift();
			await writeQueue(queue);
		}
		await writeQueue(queue);
	})().finally(() => {
		flushing = null;
	});
	return flushing;
}

export async function saveToThymer(clip: ThymerClip): Promise<ThymerSaveResponse> {
	await flushThymerQueue();
	try {
		return { success: true, result: await saver.save(clip) };
	} catch (error) {
		if (error instanceof ThymerUnreachableError) {
			const queue = await readQueue();
			queue.push(clip);
			await writeQueue(queue);
			return { success: false, queued: true, error: error.message };
		}
		return { success: false, queued: false, error: error instanceof Error ? error.message : String(error) };
	}
}

export function initThymerBackground(): void {
	browser.alarms.onAlarm.addListener(alarm => {
		if (alarm.name === RETRY_ALARM) {
			flushThymerQueue();
		}
	});
	flushThymerQueue();
}
