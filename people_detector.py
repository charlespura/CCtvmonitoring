
import cv2
import sys
import numpy as np
import json
import base64
from datetime import datetime

# Load pre-trained HOG descriptor for people detection
hog = cv2.HOGDescriptor()
hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

# Zone definitions
enter_zone = {"x1":0,"y1":150,"x2":320,"y2":350}
exit_zone = {"x1":320,"y1":150,"x2":640,"y2":350}
config = {"FRAME_RATE":2,"PERSON_TIMEOUT":3000,"MOVEMENT_THRESHOLD":100,"DETECTION_CONFIDENCE":0.3,"STREAM_SCALE_WIDTH":640,"ZONE_BUFFER":20}

def draw_zones(frame):
    # Draw enter zone (green) - semi-transparent
    overlay = frame.copy()
    cv2.rectangle(overlay, 
                  (enter_zone['x1'], enter_zone['y1']), 
                  (enter_zone['x2'], enter_zone['y2']), 
                  (0, 255, 0), -1)
    cv2.addWeighted(overlay, 0.2, frame, 0.8, 0, frame)
    
    cv2.rectangle(frame, 
                  (enter_zone['x1'], enter_zone['y1']), 
                  (enter_zone['x2'], enter_zone['y2']), 
                  (0, 255, 0), 2)
    cv2.putText(frame, 'ENTER ZONE', 
                (enter_zone['x1'], enter_zone['y1'] - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
    
    # Draw exit zone (red) - semi-transparent
    overlay = frame.copy()
    cv2.rectangle(overlay, 
                  (exit_zone['x1'], exit_zone['y1']), 
                  (exit_zone['x2'], exit_zone['y2']), 
                  (0, 0, 255), -1)
    cv2.addWeighted(overlay, 0.2, frame, 0.8, 0, frame)
    
    cv2.rectangle(frame, 
                  (exit_zone['x1'], exit_zone['y1']), 
                  (exit_zone['x2'], exit_zone['y2']), 
                  (0, 0, 255), 2)
    cv2.putText(frame, 'EXIT ZONE', 
                (exit_zone['x1'], exit_zone['y1'] - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
    
    return frame

def detect_people(frame_data):
    try:
        # Convert base64 to image
        img_data = base64.b64decode(frame_data)
        nparr = np.frombuffer(img_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            return {'error': 'Could not decode image'}
        
        # Resize frame for faster processing
        height, width = frame.shape[:2]
        target_width = config.get('STREAM_SCALE_WIDTH', 640)
        scale = target_width / width
        new_width = target_width
        new_height = int(height * scale)
        frame = cv2.resize(frame, (new_width, new_height))
        
        # Draw zones on frame
        frame_with_zones = draw_zones(frame.copy())
        
        # Detect people
        (rects, weights) = hog.detectMultiScale(
            frame, 
            winStride=(4, 4),
            padding=(8, 8), 
            scale=1.05
        )
        
        people = []
        zone_buffer = config.get('ZONE_BUFFER', 20)
        
        for i, (x, y, w, h) in enumerate(rects):
            if weights[i] < config['DETECTION_CONFIDENCE']:
                continue
                
            center_x = x + w // 2
            center_y = y + h // 2
            
            # Check if in zones with buffer
            in_enter = (enter_zone['x1'] - zone_buffer <= center_x <= enter_zone['x2'] + zone_buffer and 
                       enter_zone['y1'] - zone_buffer <= center_y <= enter_zone['y2'] + zone_buffer)
            in_exit = (exit_zone['x1'] - zone_buffer <= center_x <= exit_zone['x2'] + zone_buffer and 
                      exit_zone['y1'] - zone_buffer <= center_y <= exit_zone['y2'] + zone_buffer)
            
            # Draw rectangle around person
            if in_enter:
                color = (0, 255, 0)  # Green for enter zone
            elif in_exit:
                color = (0, 0, 255)  # Red for exit zone
            else:
                color = (255, 255, 0)  # Yellow for elsewhere
            
            cv2.rectangle(frame_with_zones, (x, y), (x + w, y + h), color, 2)
            cv2.putText(frame_with_zones, f'P{i} ({weights[i]:.2f})', (x, y - 5),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
            
            people.append({
                'id': i,
                'x': center_x,
                'y': center_y,
                'width': w,
                'height': h,
                'confidence': float(weights[i]),
                'in_enter_zone': in_enter,
                'in_exit_zone': in_exit
            })
        
        # Convert frame back to base64 for sending to client
        _, buffer = cv2.imencode('.jpg', frame_with_zones)
        frame_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return {
            'people': people,
            'frame': frame_base64,
            'count': len(people),
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        return {'error': str(e)}

# Main loop
while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break
            
        data = json.loads(line)
        result = detect_people(data['frame'])
        print(json.dumps(result))
        sys.stdout.flush()
        
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.stdout.flush()
