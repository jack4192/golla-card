
import React, { useState } from 'react';

import DailyRoutineQuestionsScreen
  from './DailyRoutineQuestionsScreen';

import DetailedRoutineScreen
  from './DetailedRoutineScreen';

// DETAILED_ROUTINE_FLOW_V1
export default function DailyRoutineScreen(props) {
  const [step, setStep] = useState('basic');

  const [basic, setBasic] = useState(
    props.initialDraft ?? null
  );

  const [details, setDetails] = useState(null);

  const remember = profile => {
    setBasic(profile);
    props.onDraftChange?.(profile);
  };

  if (step === 'details') {
    return (
      <DetailedRoutineScreen
        initialDraft={details}
        onDraftChange={setDetails}
        readOnly={props.readOnly}
        onSaved={remember}
        onBack={() => setStep('basic')}
        onContinue={props.onContinue}
      />
    );
  }

  return (
    <DailyRoutineQuestionsScreen
      {...props}
      initialDraft={basic}
      onDraftChange={remember}
      onContinue={() => setStep('details')}
    />
  );
}
