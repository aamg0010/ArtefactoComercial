'use server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { processSyncOutbox, retryFailed } from '@/lib/trygestion/sync';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { syncEmailReplies } from '@/lib/trygestion/replies';
async function administrator() { const session = await auth(); if (session?.user?.role !== 'ADMIN') throw new Error('Solo administración.'); }
export async function processNow() { await administrator(); await processSyncOutbox(prisma); await syncEmailReplies(prisma); revalidatePath('/pipeline'); revalidatePath('/mi-dia'); revalidatePath('/integracion'); redirect('/integracion'); }
export async function retryNow() { await administrator(); await retryFailed(prisma); revalidatePath('/integracion'); redirect('/integracion'); }
