import { CopyButton } from './copy-button';
import type { ReactNode } from 'react';
type Call = { apertura?: string; motivo?: string; pregunta_clave?: string; propuesta_valor?: string; objeciones?: Record<string, string>; cierre?: string; mensaje_voz?: string };
type ScriptContent = { llamada?: Call; emails?: { dia: number; asunto: string; cuerpo: string }[] };
const labels: Array<[keyof Call, string]> = [['apertura','Apertura'],['motivo','Motivo'],['pregunta_clave','Pregunta clave'],['propuesta_valor','Propuesta de valor'],['objeciones','Objeciones'],['cierre','Cierre'],['mensaje_voz','Mensaje de voz']];
export function ScriptView({ content, emailAction }: { content: ScriptContent; emailAction?: (index: number) => ReactNode }) {
  const call = content.llamada;
  return <div className="mt-2 text-sm">
    {call && <section>{labels.map(([key, label]) => {
      if (key === 'objeciones') return call.objeciones ? <div key={key}><b>{label}</b><ul>{Object.entries(call.objeciones).map(([objection, response]) => <li key={objection}><b>{objection.replaceAll('_', ' ')} →</b> {response}</li>)}</ul></div> : null;
      return call[key] ? <p key={key}><b>{label}:</b> {call[key]}</p> : null;
    })}</section>}
    <section>{content.emails?.map((email, index) => <div className="mt-3 rounded bg-slate-50 p-2" key={`${email.dia}-${email.asunto}`}><b>Día {email.dia}: {email.asunto}</b><p className="whitespace-pre-wrap">{email.cuerpo}</p><CopyButton subject={email.asunto} body={email.cuerpo}/>{emailAction?.(index)}</div>)}</section>
  </div>;
}
