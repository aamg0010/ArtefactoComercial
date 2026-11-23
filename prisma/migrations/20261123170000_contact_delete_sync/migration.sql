-- Borrado de contactos sincronizado con trygestion
ALTER TYPE "SyncKind" ADD VALUE IF NOT EXISTS 'CONTACT_DELETE';
