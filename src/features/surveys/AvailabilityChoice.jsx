const AvailabilityChoice = ({ label, value = 'available', onChange, disabled = false }) => <label className="survey-availability-choice">
  <span>{label}</span>
  <select className="input-field" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
    <option value="available">متوفرة</option>
    <option value="missing">غير موجودة</option>
  </select>
</label>;

export default AvailabilityChoice;
