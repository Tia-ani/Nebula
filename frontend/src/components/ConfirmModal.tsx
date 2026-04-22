import React from 'react';
import '../styles/ConfirmModal.css';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onYes: () => void;
  onNo: () => void;
  yesText?: string;
  noText?: string;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  onYes,
  onNo,
  yesText = 'YES',
  noText = 'NO'
}) => {
  if (!isOpen) return null;

  return (
    <div className="confirm-modal-overlay" onClick={onNo}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-header">
          <h3>{title}</h3>
        </div>
        <div className="confirm-modal-body">
          <p style={{ whiteSpace: 'pre-line' }}>{message}</p>
        </div>
        <div className="confirm-modal-footer">
          <button className="btn-modal-no" onClick={onNo}>
            {noText}
          </button>
          <button className="btn-modal-yes" onClick={onYes}>
            {yesText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
