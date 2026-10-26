use std::io::{Read, Write};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Error, ObjectId, Result, canonical_json_bytes};

const MAGIC: &[u8; 8] = b"MPSTRM\0\x01";
const MAX_FRAME: usize = 64 << 20;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StreamFrame {
    Document { document: ObjectId },
    Object { object: ObjectId, data: Vec<u8> },
    Patch { sequence: u64, patch: Value },
    End,
}

pub struct StreamWriter<W> {
    inner: W,
}
impl<W: Write> StreamWriter<W> {
    pub fn new(mut inner: W) -> Result<Self> {
        inner.write_all(MAGIC).map_err(stream_io)?;
        Ok(Self { inner })
    }
    pub fn write_frame(&mut self, frame: &StreamFrame) -> Result<()> {
        if let StreamFrame::Object { object, data } = frame {
            let actual = ObjectId::from_bytes(data);
            if &actual != object {
                return Err(Error::DigestMismatch {
                    expected: object.to_string(),
                    actual: actual.digest(),
                });
            }
        }
        let encoded = canonical_json_bytes(frame)?;
        if encoded.len() > MAX_FRAME {
            return Err(Error::InvalidStream("frame exceeds size limit".into()));
        }
        self.inner
            .write_all(&(encoded.len() as u32).to_le_bytes())
            .map_err(stream_io)?;
        self.inner.write_all(&encoded).map_err(stream_io)?;
        self.inner.flush().map_err(stream_io)
    }
    pub fn into_inner(self) -> W {
        self.inner
    }
}

pub struct StreamReader<R> {
    inner: R,
    ended: bool,
}
impl<R: Read> StreamReader<R> {
    pub fn new(mut inner: R) -> Result<Self> {
        let mut magic = [0; 8];
        inner.read_exact(&mut magic).map_err(stream_io)?;
        if &magic != MAGIC {
            return Err(Error::InvalidStream("bad magic".into()));
        }
        Ok(Self {
            inner,
            ended: false,
        })
    }
    pub fn read_frame(&mut self) -> Result<Option<StreamFrame>> {
        if self.ended {
            return Ok(None);
        }
        let mut length = [0; 4];
        match self.inner.read_exact(&mut length) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Err(Error::InvalidStream("missing end frame".into()));
            }
            Err(error) => return Err(stream_io(error)),
        }
        let length = u32::from_le_bytes(length) as usize;
        if length > MAX_FRAME {
            return Err(Error::InvalidStream("frame exceeds size limit".into()));
        }
        let mut encoded = vec![0; length];
        self.inner.read_exact(&mut encoded).map_err(stream_io)?;
        let frame: StreamFrame = serde_json::from_slice(&encoded)?;
        if let StreamFrame::Object { object, data } = &frame {
            let actual = ObjectId::from_bytes(data);
            if &actual != object {
                return Err(Error::DigestMismatch {
                    expected: object.to_string(),
                    actual: actual.digest(),
                });
            }
        }
        if frame == StreamFrame::End {
            self.ended = true;
        }
        Ok(Some(frame))
    }
}

fn stream_io(error: std::io::Error) -> Error {
    Error::InvalidStream(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let data = b"array".to_vec();
        let frame = StreamFrame::Object {
            object: ObjectId::from_bytes(&data),
            data,
        };
        let mut writer = StreamWriter::new(Vec::new()).unwrap();
        writer.write_frame(&frame).unwrap();
        writer.write_frame(&StreamFrame::End).unwrap();
        let bytes = writer.into_inner();
        let mut reader = StreamReader::new(bytes.as_slice()).unwrap();
        assert_eq!(reader.read_frame().unwrap(), Some(frame));
        assert_eq!(reader.read_frame().unwrap(), Some(StreamFrame::End));
        assert_eq!(reader.read_frame().unwrap(), None);
    }
}
