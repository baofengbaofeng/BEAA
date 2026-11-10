import {QuizError,validateQuestionBank} from './bank.mjs';
const topics={math:'arithmetic',chinese:'poetry',english:'vocabulary'};
/** Preserve content and answer order; only existing browser topic labels are representable. */
export function exportBrowserQuestionBank(input){
 const bank=validateQuestionBank(input);
 const converted=bank.questions.map(q=>{
  if(q.id.length>80||q.stem.length>1000||q.explanation.length>2000||q.options?.some(option=>option.text.length>500))throw new QuizError('BROWSER_FORMAT_UNSUPPORTED','Question exceeds the existing browser format limits');
  const answer=q.options?{options:q.options.map(option=>option.text),answer:q.options.findIndex(option=>option.id===q.correctOptionId)}:{answer:q.correctAnswer,...(q.absoluteTolerance!==undefined?{absoluteTolerance:q.absoluteTolerance}:{})};
  return {...(q.type!=='single_choice'?{type:q.type}:{}),...answer,id:q.id,grade:q.grade,subject:q.subject,topic:topics[q.subject],text:q.stem,explain:q.explanation};
 });
 // Match the actual two-space JSON artifact and the browser textarea's UTF16 limit.
 if((JSON.stringify(converted,null,2)+'\n').length>2000000)throw new QuizError('BROWSER_FORMAT_UNSUPPORTED','Serialized question bank exceeds the browser import size limit');
 return converted;
}
