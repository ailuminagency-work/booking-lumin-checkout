import {type Answers,type FlowConfig,type ServiceRender,orderedQuestions} from './types';
import {QuestionControls} from './ConfigurableQuestionForm';
export function QuestionForm({service,config,answers,onChange,disabled=false}:{service:ServiceRender;config:FlowConfig;answers:Answers;onChange:(next:Answers)=>void;disabled?:boolean}){
 let questions;try{questions=orderedQuestions(service,config);}catch{return <p role="alert">This questionnaire is unavailable.</p>;}
 return <QuestionControls questions={questions} answers={answers} onChange={onChange} disabled={disabled}/>;
}
