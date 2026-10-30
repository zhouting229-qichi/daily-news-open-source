// Count serialized UTF-8 bytes, not characters: Chinese history grows faster.
// Drop complete oldest turns so a long conversation can always accept a new question.
export function questionPayload({edition,articleId,question,history=[]}){
  const payload={edition,articleId,question,history:history.slice(-8)};
  while(payload.history.length&&new TextEncoder().encode(JSON.stringify(payload)).length>18000)payload.history.splice(0,2);
  return payload;
}
